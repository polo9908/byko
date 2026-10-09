import { randomUUID } from "node:crypto"
import {
  RUN_TIMEOUT_MS,
  requiredCaptureKeys,
  type AutomationRecipe,
  type AutomationRecipeId,
  type AutomationRunStatus,
  type BridgeMessage,
} from "../../shared/browserAutomation"
import type { ConnectableConnectorId } from "../../shared/connectors"
import type { BridgeLogger } from "./bridge"

export interface RunnerBridge {
  send: (message: BridgeMessage) => void
}

export interface RunnerOptions {
  bridge: RunnerBridge
  /** Remet les valeurs capturées au connecteur. Voir `apply.ts`. */
  apply: (connector: ConnectableConnectorId, values: Readonly<Record<string, string>>) => Promise<void>
  logger: BridgeLogger
  /** Durée de vie maximale d'une exécution, délai de l'étape comprise. */
  timeoutMs?: number
}

/**
 * Machine à états d'une exécution de recette, côté main.
 *
 * Elle ne touche jamais au DOM et ne connaît aucun sélecteur : elle envoie la
 * recette, suit la progression, ramasse les valeurs, puis les remet au
 * connecteur. Volontairement sans dépendance à Electron, pour être testable
 * hors de l'application.
 */
export class BrowserAutomationRunner {
  private runId: string | null = null
  private recipe: AutomationRecipe | null = null
  private stepIndex: number | null = null
  private state: AutomationRunStatus["state"] = "idle"
  private detail: string | null = null
  private recipeId: AutomationRecipeId | null = null
  private stepCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly captures = new Map<string, string>()
  private readonly timeoutMs: number

  constructor(private readonly options: RunnerOptions) {
    this.timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS
  }

  get status(): AutomationRunStatus {
    return {
      state: this.state,
      recipeId: this.recipeId,
      stepIndex: this.stepIndex,
      stepCount: this.stepCount,
      detail: this.detail,
    }
  }

  /** Démarre une recette. Une seule exécution à la fois. */
  start(recipe: AutomationRecipe): string {
    if (this.runId) throw new Error("Une automatisation est déjà en cours.")

    const runId = randomUUID()
    this.runId = runId
    this.recipe = recipe
    this.recipeId = recipe.id
    this.stepCount = recipe.steps.length
    this.stepIndex = 0
    this.state = "running"
    this.detail = recipe.steps[0]?.description ?? null
    this.captures.clear()
    this.options.bridge.send({ type: "run", runId, recipe })
    this.arm()
    return runId
  }

  /** Interrompt l'exécution en cours. Sans effet s'il n'y en a pas. */
  cancel(): void {
    if (!this.runId) return
    this.options.bridge.send({ type: "cancel", runId: this.runId })
    this.finish("cancelled", "Automatisation annulée.")
  }

  /** Reçoit les messages de l'extension. Ceux d'une exécution périmée sont ignorés. */
  handleMessage(message: BridgeMessage): void {
    if (!("runId" in message)) return
    if (!this.runId || message.runId !== this.runId) return

    switch (message.type) {
      case "step":
        this.stepIndex = message.index
        if (message.status === "waiting") {
          this.state = "awaiting-human"
        }
        this.detail = message.detail ?? this.detail
        return
      case "capture":
        // Jamais journalisé : une capture est un identifiant de connexion.
        this.captures.set(message.key, message.value)
        return
      case "finished":
        if (message.outcome === "failed") {
          this.finish("failed", message.reason ?? "La recette a échoué.")
          return
        }
        void this.apply()
        return
      default:
        return
    }
  }

  private async apply(): Promise<void> {
    const recipe = this.recipe
    if (!recipe) {
      this.finish("failed", "Aucune recette active.")
      return
    }

    const missing = requiredCaptureKeys(recipe).filter((key) => !this.captures.has(key))
    if (missing.length > 0) {
      this.finish("failed", `La recette n'a pas ramené : ${missing.join(", ")}.`)
      return
    }

    this.state = "applying"
    this.detail = "Enregistrement de la connexion…"
    const values = Object.fromEntries(this.captures)
    // Seul le nombre de valeurs est journalisé, jamais leur contenu.
    this.options.logger.info(`capture complète (${this.captures.size} valeur(s)), remise au connecteur`)

    try {
      await this.options.apply(recipe.connector, values)
      this.finish("done", null)
    } catch (error) {
      this.finish("failed", error instanceof Error ? error.message : String(error))
    }
  }

  private arm(): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      if (!this.runId) return
      this.options.bridge.send({ type: "cancel", runId: this.runId })
      this.finish("failed", "Délai dépassé : l'automatisation n'a pas rendu la main.")
    }, this.timeoutMs)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * Clôt l'exécution en gardant l'état affichable : `stepIndex`, `stepCount` et
   * `recipeId` restent lisibles pour l'interface, même après la fin.
   */
  private finish(state: AutomationRunStatus["state"], detail: string | null): void {
    this.clearTimer()
    this.state = state
    this.detail = detail
    this.runId = null
    this.recipe = null
    this.captures.clear()
  }
}
