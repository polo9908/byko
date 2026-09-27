import { randomUUID } from "node:crypto"
import {
  AGENT_MAX_ELEMENTS,
  AGENT_MAX_STEPS,
  AGENT_MAX_WAIT_MS,
  type AgentAction,
  type BridgeMessage,
  type ExecutableAction,
  type ObservedElement,
} from "../../shared/browserAutomation"
import type { BridgeLogger } from "./bridge"

export interface AgentBridge {
  send: (message: BridgeMessage) => void
}

export interface AgentOptions {
  bridge: AgentBridge
  logger: BridgeLogger
  /** Le modèle de l'utilisateur, déjà configuré dans BYKO. */
  complete: (prompt: string) => Promise<string>
  /** Ce qu'on cherche à obtenir, en clair, à destination du modèle. */
  goal: string
  /** Préfixe d'URL autorisé : la liste blanche d'origines. */
  urlPrefix: string
  /** Remet les identifiants trouvés au connecteur concerné. */
  applyCredentials: (clientId: string, clientSecret: string) => Promise<void>
  /** Nombre d'actions passées gardées dans le contexte du modèle. */
  historyLimit?: number
}

export type AgentState = "idle" | "running" | "capturing" | "done" | "failed" | "cancelled"

export interface AgentStatus {
  state: AgentState
  step: number
  maxSteps: number
  /** Dernière étape ou dernier motif, affichable tel quel. */
  detail: string | null
}

interface Pending {
  resolve: (message: BridgeMessage) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Boucle de pilotage : observer, faire décider, exécuter, recommencer.
 *
 * **L'invariante du contrat (§3.3) est ici, et pas ailleurs.** Le modèle ne reçoit
 * que des éléments — jamais la valeur d'un champ, jamais de capture d'écran, jamais
 * le texte libre de la page. Il ne désigne un élément que par une référence qu'il a
 * vue, et cette référence est revérifiée contre l'observation courante. Enfin, la
 * lecture des identifiants se fait **après** que le modèle a rendu la main :
 * aucune page affichant un secret n'est jamais soumise à une IA.
 *
 * Volontairement sans dépendance à Electron : le modèle, le pont et l'écriture des
 * identifiants sont injectés, donc la boucle est testable hors application.
 */
export class BrowserAutomationAgent {
  private state: AgentState = "idle"
  private step = 0
  private detail: string | null = null
  private cancelled = false
  private readonly history: string[] = []
  private readonly pending = new Map<string, Pending>()
  private readonly historyLimit: number
  private lastRefs: ReadonlySet<string> = new Set()

  constructor(private readonly options: AgentOptions) {
    this.historyLimit = options.historyLimit ?? 12
  }

  get status(): AgentStatus {
    return { state: this.state, step: this.step, maxSteps: AGENT_MAX_STEPS, detail: this.detail }
  }

  /** Interrompt la boucle à la prochaine frontière. Sans effet si rien ne tourne. */
  cancel(): void {
    if (this.state !== "running" && this.state !== "capturing") return
    this.cancelled = true
    this.detail = "Automatisation annulée."
  }

  /** Traite un message de l'extension. Rend `true` si une demande attendait cette réponse. */
  handleMessage(message: BridgeMessage): boolean {
    if (!("requestId" in message)) return false
    const entry = this.pending.get(message.requestId)
    if (!entry) return false
    clearTimeout(entry.timer)
    this.pending.delete(message.requestId)
    entry.resolve(message)
    return true
  }

  /** Déroule la boucle jusqu'à l'objectif, l'abandon, l'annulation ou la borne d'étapes. */
  async run(): Promise<void> {
    if (this.state === "running") throw new Error("Une automatisation est déjà en cours.")
    this.state = "running"
    this.cancelled = false
    this.step = 0
    this.history.length = 0

    try {
      while (this.step < AGENT_MAX_STEPS) {
        if (this.cancelled) return this.finish("cancelled", "Automatisation annulée.")

        this.step += 1
        this.detail = `Observation ${this.step}/${AGENT_MAX_STEPS}…`
        const observation = await this.observe()
        if (observation === null) return

        const action = await this.decide(observation.url, observation.elements)
        if (action === null) return

        if (action.kind === "giveUp") {
          return this.finish("failed", action.reason)
        }
        if (action.kind === "done") {
          return await this.capture(action.summary)
        }

        this.detail = describe(action)
        // Le libellé de l'élément visé est journalisé : sans lui, « cliquer sur e51 »
        // ne dit rien à qui relit le journal après coup.
        const target =
          action.kind === "click" || action.kind === "fill"
            ? observation.elements.find((element) => element.ref === action.ref)
            : undefined
        this.options.logger.info(`étape ${this.step} : ${describe(action)}${target?.name ? ` — « ${target.name} »` : ""}`)
        const executed = await this.perform(action)
        if (executed === null) return
        this.record(`${describe(action)} → ${executed ? "fait" : this.lastFailure}`)
      }

      this.finish("failed", `Objectif non atteint après ${AGENT_MAX_STEPS} étapes.`)
    } catch (error) {
      this.finish("failed", error instanceof Error ? error.message : String(error))
    }
  }

  private async observe(): Promise<{ url: string; elements: ObservedElement[] } | null> {
    const requestId = randomUUID()
    const reply = await this.request(requestId, {
      type: "observe",
      requestId,
      urlPrefix: this.options.urlPrefix,
    })

    if (reply.type === "observeFailed") {
      // Un onglet absent n'est pas une panne de l'automatisation : c'est à BYKO
      // d'ouvrir la page avant de lancer la boucle.
      this.finish("failed", reply.reason)
      return null
    }
    if (reply.type !== "observation") {
      this.finish("failed", "Réponse inattendue de l'extension.")
      return null
    }

    this.lastRefs = new Set(reply.elements.map((element) => element.ref))
    return { url: reply.url, elements: reply.elements }
  }

  private async decide(url: string, elements: readonly ObservedElement[]): Promise<AgentAction | null> {
    const prompt = buildPrompt({
      goal: this.options.goal,
      url,
      step: this.step,
      elements: elements.slice(0, AGENT_MAX_ELEMENTS),
      history: this.history.slice(-this.historyLimit),
    })

    const raw = await this.options.complete(prompt)
    let action: AgentAction
    try {
      action = parseAction(raw)
    } catch (error) {
      this.finish("failed", error instanceof Error ? error.message : "Décision illisible.")
      return null
    }

    // Le modèle ne peut viser que ce qu'il a vu : une référence inventée est
    // refusée ici, pas exécutée à l'aveugle.
    if ((action.kind === "click" || action.kind === "fill") && !this.lastRefs.has(action.ref)) {
      this.finish("failed", `Le modèle a désigné un élément inconnu (« ${action.ref} »).`)
      return null
    }
    return action
  }

  private async perform(action: ExecutableAction): Promise<boolean | null> {
    if (action.kind === "wait") {
      // Borné : un modèle ne doit pas pouvoir geler la boucle.
      await new Promise((resolve) => setTimeout(resolve, Math.min(action.ms, AGENT_MAX_WAIT_MS)))
      this.lastFailure = `attente de ${Math.min(action.ms, AGENT_MAX_WAIT_MS)} ms`
      return true
    }

    const requestId = randomUUID()
    const reply = await this.request(requestId, {
      type: "act",
      requestId,
      urlPrefix: this.options.urlPrefix,
      action,
    })

    if (reply.type === "observeFailed") return null
    if (reply.type !== "actResult") {
      this.finish("failed", "Réponse inattendue de l'extension.")
      return null
    }
    if (!reply.ok) {
      this.lastFailure = reply.detail ?? "action refusée"
      this.options.logger.warn(`action refusée : ${this.lastFailure}`)
      return false
    }
    this.lastFailure = ""
    // Laisse la page réagir avant de la réobserver : la console est une SPA, son
    // DOM ne se met pas à jour de façon synchrone.
    await new Promise((resolve) => setTimeout(resolve, 700))
    return true
  }

  private async capture(summary: string): Promise<void> {
    this.state = "capturing"
    this.detail = "Lecture des identifiants…"

    const requestId = randomUUID()
    const reply = await this.request(requestId, {
      type: "captureCredentials",
      requestId,
      urlPrefix: this.options.urlPrefix,
    })
    if (reply.type !== "credentials") {
      return this.finish("failed", "Réponse inattendue de l'extension.")
    }
    if (!reply.clientId || !reply.clientSecret) {
      const missing = !reply.clientId ? "Client ID" : "Client Secret"
      return this.finish("failed", `${missing} introuvable sur la page.`)
    }

    // Le modèle est sorti de la boucle : à partir d'ici, plus aucune IA ne voit rien.
    await this.options.applyCredentials(reply.clientId, reply.clientSecret)
    this.detail = summary
    this.finish("done", summary)
  }

  private lastFailure = ""

  private request(requestId: string, message: BridgeMessage): Promise<BridgeMessage> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({ type: "observeFailed", requestId, reason: "délai dépassé sans réponse de l'extension" })
      }, 20_000)
      this.pending.set(requestId, { resolve, timer })
      this.options.bridge.send(message)
    })
  }

  private record(entry: string): void {
    this.history.push(`étape ${this.step} : ${entry}`)
    if (this.history.length > this.historyLimit) this.history.shift()
  }

  private finish(state: AgentState, detail: string | null): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
    this.state = state
    this.detail = detail
    if (state === "failed") this.options.logger.warn(`automatisation en échec : ${detail ?? ""}`)
    else this.options.logger.info(`automatisation ${state}${detail ? ` : ${detail}` : ""}`)
  }
}

/**
 * Décrit une action pour le journal et l'historique du modèle.
 *
 * **Jamais la valeur saisie** : un `fill` porte souvent un jeton d'API — Jira,
 * Figma, une clé de fournisseur d'IA. Le journal ne doit pas en garder trace,
 * et le modèle n'a pas besoin de se voir relire ce qu'il a écrit.
 */
function describe(action: ExecutableAction): string {
  if (action.kind === "wait") return `attendre ${action.ms} ms`
  if (action.kind === "fill") return `saisir dans ${action.ref}`
  return `cliquer sur ${action.ref}`
}

interface PromptInput {
  goal: string
  url: string
  step: number
  elements: readonly ObservedElement[]
  history: readonly string[]
}

/**
 * Construit le prompt. Ce qui n'y figure pas est aussi important que ce qui y
 * figure : aucun texte libre de la page, aucune valeur de champ, aucun secret.
 */
export function buildPrompt(input: PromptInput): string {
  const elements = input.elements.map((element) => {
    const attributes = Object.entries(element.attributes)
      .filter(([key]) => key !== "aria-label")
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")
    const label = element.name ? `« ${element.name} »` : "(sans libellé)"
    const inShadow = element.shadow ? " [composant]" : ""
    return `${element.ref} | ${element.tag}${element.role ? `[${element.role}]` : ""}${inShadow} ${label} ${attributes}`
  })

  return [
    "Tu pilotes le navigateur Chrome de l'utilisateur pour configurer un connecteur.",
    "Tu reçois la liste des éléments interactifs de la page courante, et rien d'autre.",
    "",
    "Objectif :",
    input.goal,
    "",
    `Page courante : ${input.url}`,
    `Étape ${input.step}.`,
    "",
    "Ce que tu ne reçois jamais, et ne dois jamais demander : la valeur des champs",
    "(mots de passe, identifiants, jetons), ni le contenu textuel de la page. Quand",
    "l'objectif est atteint et qu'un identifiant s'affiche, ne cherche pas à le lire :",
    "déclare simplement que c'est terminé.",
    "",
    "Actions possibles, en JSON strict, sans texte autour :",
    '{"kind":"click","ref":"e12"}',
    '{"kind":"fill","ref":"e12","value":"texte à saisir"}',
    '{"kind":"wait","ms":1500}',
    '{"kind":"done","summary":"client OAuth créé"}',
    '{"kind":"giveUp","reason":"je ne trouve pas le bouton"}',
    "",
    "Contraintes : « ref » doit être une référence de la liste ci-dessous, jamais un",
    "sélecteur CSS ni un libellé. Ne clique jamais sur un élément qui détruirait des",
    "données (supprimer, révoquer, vider) : préfère giveUp. Si la page n'a pas bougé",
    "depuis l'action précédente, attends plutôt que de recliquer.",
    "",
    "Éléments de la page :",
    elements.length > 0 ? elements.join("\n") : "(aucun élément interactif détecté)",
    "",
    "Actions déjà tentées :",
    input.history.length > 0 ? input.history.join("\n") : "(aucune)",
    "",
    "Réponds par une seule action JSON.",
  ].join("\n")
}

/** Lit la décision du modèle, en refusant tout ce qui n'est pas une action connue. */
export function parseAction(raw: string): AgentAction {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("Le modèle n'a renvoyé aucune action lisible.")

  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    throw new Error("La décision du modèle n'est pas du JSON valide.")
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Décision du modèle invalide.")

  const body = parsed as Record<string, unknown>
  const ref = body.ref
  const hasRef = typeof ref === "string" && /^e\d+$/.test(ref)

  switch (body.kind) {
    case "click":
      if (!hasRef) throw new Error("Décision « click » sans référence d'élément valide.")
      return { kind: "click", ref: ref as string }
    case "fill":
      if (!hasRef) throw new Error("Décision « fill » sans référence d'élément valide.")
      if (typeof body.value !== "string") throw new Error("Décision « fill » sans valeur à saisir.")
      return { kind: "fill", ref: ref as string, value: body.value }
    case "wait": {
      const ms = typeof body.ms === "number" && Number.isFinite(body.ms) ? body.ms : 1000
      return { kind: "wait", ms: Math.max(0, Math.min(ms, AGENT_MAX_WAIT_MS)) }
    }
    case "done":
      return { kind: "done", summary: typeof body.summary === "string" ? body.summary : "terminé" }
    case "giveUp":
      return { kind: "giveUp", reason: typeof body.reason === "string" ? body.reason : "abandon du modèle" }
    default:
      throw new Error(`Action inconnue du modèle : « ${String(body.kind)} ».`)
  }
}
