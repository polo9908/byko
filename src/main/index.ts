import { app, shell, BrowserWindow, ipcMain, systemPreferences } from "electron"
import { join } from "path"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import { isEncryptionAvailable } from "./secrets"
import * as jira from "./integrations/jira"
import * as aiProvider from "./integrations/ai-provider"
import * as figma from "./integrations/figma"
import * as googleCalendar from "./integrations/google-calendar"
import { listConnectors } from "./connectors/registry"
import * as connectorSetup from "./connectors/setup-pages"
import { BrowserAutomationBridge } from "./browser-automation/bridge"
import { browserAutomationSocketPath } from "./browser-automation/socket-path"
import { BrowserAutomationRecon, normalizeUrlPrefix } from "./browser-automation/recon"
import { BrowserAutomationAgent } from "./browser-automation/agent"
import * as journal from "./journal"
import * as meetingDecisions from "./meetingDecisions"
import { createTicketCache, learnedSuggestions, matchSuggestions, mergeLearnedShortcuts } from "./assistantSuggest"
import { buildAskPrompt, selectRecentDecisions, selectRecentJournal } from "./assistantContext"
import type { ActivityContext, ContextSource } from "./assistantContext"
import * as privacy from "./privacy"
import type { PrivacySettings } from "../shared/privacy"
import * as vocabulary from "./vocabulary"
import type { PersonalShortcut, ShortcutDraft } from "../shared/vocabulary"
import {
  VOCABULARY_DETAIL_MAX_CHARS,
  VOCABULARY_LABEL_MAX_CHARS,
  VOCABULARY_MAX_CHARS,
  VOCABULARY_MIN_CHARS,
  VOCABULARY_QUESTION_MAX_CHARS,
} from "../shared/vocabulary"
import * as autonomy from "./autonomy"
import * as speech from "./speech"
import { AI_PROVIDERS } from "../shared/ai"
import type { AIProviderId } from "../shared/ai"
import { AUTONOMY_CATEGORY_IDS, AUTONOMY_MAX_LEVEL } from "../shared/autonomy"
import type { AutonomyCategoryId } from "../shared/autonomy"
import type {
  MeetingItemDraft,
  MeetingItemRemoval,
  MeetingItemType,
  MeetingExtraction,
} from "../shared/meeting"
import { MEETING_ITEM_MAX_CHARS, MEETING_REPORT_MAX_ITEMS } from "../shared/meeting"
import type { AssistantAnswer, AssistantSuggestion } from "../shared/assistant"
import { ASSISTANT_SUGGEST_MAX_CHARS, ASSISTANT_SUGGEST_MIN_CHARS } from "../shared/assistant"
import type { JiraTicketSummary } from "../shared/jira"
import { GOOGLE_CALENDAR_SETUP_PAGES } from "../shared/googleCalendar"
import type { GoogleCalendarSetupPage } from "../shared/googleCalendar"
import { CONNECTOR_SETUP_PAGES } from "../shared/connectors"
import type { ConnectorSetupPage } from "../shared/connectors"

/** Validation stricte des payloads reçus par IPC avant de les transmettre aux intégrations. */
function assertNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Paramètre "${name}" invalide.`)
  }
  return value
}

/** Type seul : le format fin (trim, motif) est validé par l'intégration, avec un message métier. */
function assertString(value: unknown, name: string, maxLength = 1024): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Paramètre "${name}" invalide.`)
  }
  return value
}

function assertCalendarSetupPage(value: unknown): GoogleCalendarSetupPage {
  if (typeof value === "string" && GOOGLE_CALENDAR_SETUP_PAGES.includes(value as GoogleCalendarSetupPage)) {
    return value as GoogleCalendarSetupPage
  }
  throw new Error(`Paramètre "page" invalide.`)
}

function assertConnectorSetupPage(value: unknown): ConnectorSetupPage {
  if (typeof value === "string" && CONNECTOR_SETUP_PAGES.includes(value as ConnectorSetupPage)) {
    return value as ConnectorSetupPage
  }
  throw new Error(`Paramètre "page" invalide.`)
}

function assertProviderId(value: unknown): AIProviderId {
  if (typeof value === "string" && AI_PROVIDERS.some((provider) => provider.id === value)) {
    return value as AIProviderId
  }
  throw new Error(`Paramètre "provider" invalide.`)
}

function assertAutonomyCategoryId(value: unknown): AutonomyCategoryId {
  if (typeof value === "string" && AUTONOMY_CATEGORY_IDS.includes(value as AutonomyCategoryId)) {
    return value as AutonomyCategoryId
  }
  throw new Error(`Paramètre "id" invalide.`)
}

function assertLevel(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= AUTONOMY_MAX_LEVEL) {
    return value
  }
  throw new Error(`Paramètre "level" invalide.`)
}

/**
 * Une source de suggestions en échec vaut « vide » pour cet appel, les autres
 * répondent. Seuls le nom et le code de l'erreur sont tracés : son message peut
 * citer le contenu d'un fichier (ex. `JSON.parse` sur `journal.json`).
 */
function settledOrEmpty<T>(result: PromiseSettledResult<T[]>, source: string): T[] {
  if (result.status === "fulfilled") return result.value
  warnSourceUnavailable("assistant:suggest", source, result.reason)
  return []
}

/** Nom et code de l'erreur seulement : son message peut citer le contenu d'un fichier. */
function warnSourceUnavailable(channel: string, source: string, reason: unknown): void {
  const name = reason instanceof Error ? reason.name : "erreur inconnue"
  const code = (reason as NodeJS.ErrnoException | null)?.code
  console.warn(
    `[${channel}] source « ${source} » indisponible (${typeof code === "string" ? `${name}, ${code}` : name}).`,
  )
}

/** Pour `assistant:ask` : une source en échec reste « indisponible » dans le prompt, jamais une liste vide. */
function settledOrUnavailable<T>(
  result: PromiseSettledResult<T[]>,
  source: string,
  select: (value: T[]) => T[],
): ContextSource<T> {
  if (result.status === "fulfilled") return { status: "ok", value: select(result.value) }
  warnSourceUnavailable("assistant:ask", source, result.reason)
  return { status: "unavailable" }
}

/** Fail-closed : un réglage qu'on ne peut pas lire n'autorise pas le partage. Relu à chaque appel. */
async function shouldShareRecentActivity(): Promise<boolean> {
  try {
    return (await privacy.getSettings()).shareRecentActivityWithAi
  } catch (error) {
    warnSourceUnavailable("privacy", "réglage de confidentialité", error)
    return false
  }
}

/** Borne un texte produit par l'IA sans couper une paire de substitution UTF-16 en deux. */
function truncateMeetingText(text: string): string {
  if (text.length <= MEETING_ITEM_MAX_CHARS) return text
  let cut = text.slice(0, MEETING_ITEM_MAX_CHARS)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut.trimEnd()
}

/** UUID canonique (8-4-4-4-12, hexadécimal, versions 1 à 8) : le renderer le génère via `crypto.randomUUID()`. */
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertReportId(value: unknown): string {
  if (typeof value !== "string" || !REPORT_ID_PATTERN.test(value)) {
    throw new Error(`Paramètre "reportId" invalide : identifiant de compte rendu (UUID) attendu.`)
  }
  // Minuscules : un même UUID envoyé en casse différente reste le même compte rendu.
  return value.toLowerCase()
}

/** Tout ou rien : un seul élément invalide rejette le lot, rien n'est écrit. */
function assertMeetingItems(value: unknown): MeetingItemDraft[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Paramètre "items" invalide : une liste de décisions et de tâches est attendue.`,
    )
  }
  if (value.length > MEETING_REPORT_MAX_ITEMS) {
    throw new Error(
      `Compte rendu trop long : ${MEETING_REPORT_MAX_ITEMS} décisions et tâches au maximum.`,
    )
  }
  return value.map((item: unknown, index): MeetingItemDraft => {
    const position = index + 1
    if (typeof item !== "object" || item === null) {
      throw new Error(`Élément n°${position} du compte rendu invalide.`)
    }
    const candidate = item as Record<string, unknown>
    if (candidate.type !== "decision" && candidate.type !== "task") {
      throw new Error(
        `Élément n°${position} du compte rendu : type inconnu (décision ou tâche attendue).`,
      )
    }
    if (typeof candidate.text !== "string") {
      throw new Error(`Élément n°${position} du compte rendu : texte manquant.`)
    }
    const text = candidate.text.trim()
    if (text === "") {
      throw new Error(`Élément n°${position} du compte rendu : texte vide.`)
    }
    if (text.length > MEETING_ITEM_MAX_CHARS) {
      throw new Error(
        `Élément n°${position} du compte rendu : ${MEETING_ITEM_MAX_CHARS} caractères au maximum.`,
      )
    }
    return { type: candidate.type, text }
  })
}

/** Cible d'un raccourci appris (`vocabulary:record`) : tout ou rien, rien n'est écrit sinon. */
function assertShortcutDraft(value: unknown): ShortcutDraft {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Paramètre "shortcut" invalide : un objet est attendu.`)
  }
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== "ticket" && candidate.kind !== "journal" && candidate.kind !== "decision") {
    throw new Error(`Raccourci invalide : type inconnu (ticket, journal ou décision attendu).`)
  }
  const targetId = assertNonEmptyString(candidate.targetId, "targetId")
  if (targetId.length > VOCABULARY_MAX_CHARS) {
    throw new Error(`Raccourci invalide : identifiant de cible trop long.`)
  }
  if (
    typeof candidate.label !== "string" ||
    candidate.label.trim() === "" ||
    candidate.label.length > VOCABULARY_LABEL_MAX_CHARS
  ) {
    throw new Error(`Raccourci invalide : libellé manquant ou trop long.`)
  }
  if (
    typeof candidate.question !== "string" ||
    candidate.question.trim() === "" ||
    candidate.question.length > VOCABULARY_QUESTION_MAX_CHARS
  ) {
    throw new Error(`Raccourci invalide : question manquante ou trop longue.`)
  }
  if (
    candidate.detail !== undefined &&
    (typeof candidate.detail !== "string" || candidate.detail.length > VOCABULARY_DETAIL_MAX_CHARS)
  ) {
    throw new Error(`Raccourci invalide : complément trop long.`)
  }
  return {
    kind: candidate.kind,
    targetId,
    label: candidate.label,
    question: candidate.question,
    ...(candidate.detail === undefined ? {} : { detail: candidate.detail as string }),
  }
}

/** Phrase réellement tapée au moment où l'utilisateur a choisi la suggestion. */
function assertShortcutQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Paramètre "query" invalide : une chaîne est attendue.`)
  }
  const text = value.trim()
  if (text.length < VOCABULARY_MIN_CHARS || text.length > VOCABULARY_MAX_CHARS) {
    throw new Error(
      `Raccourci invalide : entre ${VOCABULARY_MIN_CHARS} et ${VOCABULARY_MAX_CHARS} caractères attendus.`,
    )
  }
  return text
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow.show()
  })

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[preload-error]", preloadPath, error)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.byko.app")

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle("app:getVersion", () => app.getVersion())
  ipcMain.handle("secrets:isEncryptionAvailable", () => isEncryptionAvailable())

  ipcMain.handle("jira:openTokenPage", () => jira.openTokenPage())
  ipcMain.handle("jira:getStatus", () => jira.getStatus())
  // Cache des tickets de `assistant:suggest`, déclaré ici pour être vidé par connect/disconnect.
  const suggestTickets = createTicketCache(
    () => jira.searchOpenIssues(),
    (error) => {
      // Seule la cause Jira est tracée, jamais la saisie qui a déclenché l'appel.
      console.warn(
        "[assistant:suggest] tickets indisponibles pour 30 s :",
        error instanceof Error ? error.message : "erreur inconnue",
      )
    },
  )

  ipcMain.handle("jira:disconnect", async () => {
    try {
      return await jira.disconnect()
    } finally {
      suggestTickets.invalidate()
    }
  })
  ipcMain.handle(
    "jira:connect",
    async (_event, domain: unknown, email: unknown, apiToken: unknown) => {
      const validDomain = assertNonEmptyString(domain, "domain")
      const validEmail = assertNonEmptyString(email, "email")
      const validToken = assertNonEmptyString(apiToken, "apiToken")
      try {
        return await jira.connect(validDomain, validEmail, validToken)
      } finally {
        suggestTickets.invalidate()
      }
    },
  )
  ipcMain.handle("jira:listProjects", () => jira.listProjects())
  ipcMain.handle("jira:countOpenIssues", () => jira.countOpenIssues())
  ipcMain.handle("jira:searchOpenIssues", () => jira.searchOpenIssues())
  ipcMain.handle("jira:setDefaultProject", (_event, projectKey: unknown) =>
    jira.setDefaultProject(assertNonEmptyString(projectKey, "projectKey")),
  )
  ipcMain.handle("jira:createIssue", (_event, summary: unknown) =>
    jira.createIssue(assertNonEmptyString(summary, "summary")),
  )
  ipcMain.handle("jira:updateIssueSummary", (_event, issueKey: unknown, summary: unknown) =>
    jira.updateIssueSummary(assertNonEmptyString(issueKey, "issueKey"), assertNonEmptyString(summary, "summary")),
  )
  ipcMain.handle("jira:deleteIssue", (_event, issueKey: unknown) =>
    jira.deleteIssue(assertNonEmptyString(issueKey, "issueKey")),
  )
  ipcMain.handle("jira:getTicket", (_event, issueKey: unknown) =>
    jira.getTicket(assertNonEmptyString(issueKey, "issueKey")),
  )
  ipcMain.handle("jira:postComment", (_event, issueKey: unknown, body: unknown) =>
    jira.postComment(assertNonEmptyString(issueKey, "issueKey"), assertNonEmptyString(body, "body")),
  )
  ipcMain.handle("jira:deleteComment", (_event, issueKey: unknown, commentId: unknown) =>
    jira.deleteComment(assertNonEmptyString(issueKey, "issueKey"), assertNonEmptyString(commentId, "commentId")),
  )

  ipcMain.handle("ai:getStatus", () => aiProvider.getStatus())
  ipcMain.handle("ai:openKeyPage", (_event, provider: unknown) => aiProvider.openKeyPage(assertProviderId(provider)))
  ipcMain.handle("ai:useDetectedKey", (_event, provider: unknown) =>
    aiProvider.useDetectedKey(assertProviderId(provider)),
  )
  ipcMain.handle("ai:setCustomKey", (_event, provider: unknown, key: unknown) =>
    aiProvider.setCustomKey(assertProviderId(provider), assertNonEmptyString(key, "key")),
  )
  ipcMain.handle("ai:disconnect", (_event, provider: unknown) => aiProvider.disconnect(assertProviderId(provider)))

  ipcMain.handle("figma:openTokenPage", () => figma.openTokenPage())
  ipcMain.handle("figma:getStatus", () => figma.getStatus())
  ipcMain.handle("figma:disconnect", () => figma.disconnect())
  ipcMain.handle("figma:connect", (_event, token: unknown) => figma.connect(assertNonEmptyString(token, "token")))

  ipcMain.handle("calendar:connect", () => googleCalendar.connect())
  ipcMain.handle("calendar:getStatus", () => googleCalendar.getStatus())
  ipcMain.handle("calendar:disconnect", () => googleCalendar.disconnect())
  ipcMain.handle("calendar:listTodayEvents", () => googleCalendar.listTodayEvents())
  ipcMain.handle("calendar:getCredentialsStatus", () => googleCalendar.getCredentialsStatus())
  ipcMain.handle("calendar:openSetupPage", (_event, page: unknown) =>
    googleCalendar.openSetupPage(assertCalendarSetupPage(page)),
  )
  ipcMain.handle("calendar:connectWithCredentials", (_event, clientId: unknown, clientSecret: unknown) =>
    googleCalendar.connectWithCredentials(assertString(clientId, "clientId"), assertString(clientSecret, "clientSecret")),
  )
  ipcMain.handle("calendar:cancelConnect", () => googleCalendar.cancelConnect())

  ipcMain.handle("settings:listConnectors", () => listConnectors())
  ipcMain.handle("connectors:openSetupPage", (_event, page: unknown) =>
    connectorSetup.openSetupPage(assertConnectorSetupPage(page)),
  )

  ipcMain.handle("journal:listToday", () => journal.listToday())
  ipcMain.handle("journal:cancel", async (_event, id: unknown) => {
    const entryId = assertNonEmptyString(id, "id")
    const entry = await journal.getEntry(entryId)
    if (!entry) {
      throw new Error("Entrée de journal introuvable.")
    }
    if (!entry.undo) {
      throw new Error("Cette action n'est plus annulable.")
    }
    if (entry.undo.type === "jira-comment") {
      await jira.deleteComment(entry.undo.issueKey, entry.undo.commentId)
    }
    await journal.removeEntry(entryId)
  })

  ipcMain.handle("autonomy:list", () => autonomy.list())
  ipcMain.handle("autonomy:setLevel", (_event, id: unknown, level: unknown) =>
    autonomy.setLevel(assertAutonomyCategoryId(id), assertLevel(level)),
  )

  ipcMain.handle("meeting:requestMicAccess", async () => {
    if (process.platform !== "darwin") return true
    if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true
    return systemPreferences.askForMediaAccess("microphone")
  })

  ipcMain.handle("speech:prepare", () => speech.prepare())
  ipcMain.handle("speech:transcribe", (_event, audio: unknown) => {
    if (!(audio instanceof Float32Array) || audio.length === 0) {
      throw new Error(`Paramètre "audio" invalide.`)
    }
    if (audio.length > speech.SAMPLE_RATE * speech.MAX_AUDIO_SECONDS) {
      throw new Error(`Enregistrement trop long (${speech.MAX_AUDIO_SECONDS} s maximum).`)
    }
    return speech.transcribe(audio)
  })

  ipcMain.handle("meeting:summarize", async (_event, transcript: unknown) => {
    const text = assertNonEmptyString(transcript, "transcript")
    const prompt = [
      "Voici la transcription d'un point d'équipe (réunion courte).",
      "Rédige un compte rendu court en français, 3 à 5 puces maximum,",
      "des sujets et décisions abordés. Pas d'introduction, juste les puces.",
      "",
      "Transcription :",
      text,
    ].join("\n")
    return aiProvider.complete(prompt)
  })

  ipcMain.handle("meeting:sendReport", async (_event, reportId: unknown, items: unknown) => {
    const id = assertReportId(reportId)
    const drafts = assertMeetingItems(items)
    await meetingDecisions.saveReport(id, drafts)
    await journal.addEntry("Compte rendu du point d'équipe envoyé à l'équipe", "auto")
  })

  ipcMain.handle(
    "meeting:extractItems",
    async (
      _event,
      transcript: unknown,
      existingDecisions: unknown,
      existingTasks: unknown,
      rejectedTexts: unknown,
    ): Promise<MeetingExtraction> => {
      const text = assertNonEmptyString(transcript, "transcript")
      const decisions = Array.isArray(existingDecisions)
        ? existingDecisions.filter((item): item is string => typeof item === "string")
        : []
      const tasks = Array.isArray(existingTasks)
        ? existingTasks.filter((item): item is string => typeof item === "string")
        : []
      const rejected = Array.isArray(rejectedTexts)
        ? rejectedTexts.filter((item): item is string => typeof item === "string")
        : []
      const numbered = (items: string[], prefix: string): string =>
        items.length ? items.map((item, index) => `${prefix}${index + 1}. ${item}`).join("\n") : "aucune"

      const prompt = [
        "Voici la transcription d'un point d'équipe, telle qu'entendue jusqu'à présent :",
        '"""',
        text,
        '"""',
        "",
        "Décisions déjà notées :",
        numbered(decisions, "D"),
        "",
        "Tâches déjà notées :",
        numbered(tasks, "T"),
        "",
        rejected.length
          ? `Éléments déjà explicitement annulés plus tôt — ne les repropose JAMAIS, même reformulés : ${rejected.join(" / ")}`
          : "",
        "",
        "Distingue bien les deux catégories :",
        "- decision : un choix ou un accord acté par l'équipe, sans action concrète à réaliser par",
        "  quelqu'un (ex. « on garde le format actuel », « on reporte la mise en prod à vendredi »,",
        "  « on annule cette fonctionnalité »).",
        "- task : une action concrète à réaliser, même sans nom de personne ni échéance précisés",
        "  (ex. « il faut corriger X », « rendre le champ Y obligatoire », « ajouter un bouton Z »,",
        "  « quelqu'un doit mettre à jour… »). Toute phrase qui décrit CE QU'IL FAUT FAIRE est une task,",
        "  pas une decision — même formulée à l'impératif ou sans sujet explicite.",
        "",
        "Identifie deux choses, en te basant STRICTEMENT sur ce qui est exprimé dans la transcription,",
        "sans jamais rien inventer :",
        "1. Les décisions ou tâches nouvelles et clairement exprimées, absentes des listes ci-dessus ET",
        "   absentes des éléments déjà annulés.",
        "2. Parmi les décisions/tâches déjà notées ci-dessus (pas les éléments déjà annulés), celles que",
        "   la suite de la transcription annule, contredit ou invalide explicitement (ex. « en fait non »,",
        "   « on revient sur… », « on annule… »). Réfère-toi à elles par leur numéro exact (D1, T2…).",
        "",
        "Réponds STRICTEMENT en JSON, sans texte autour, exactement sous cette forme :",
        '{"additions": [{"type": "decision", "text": "..."}], "removals": [{"type": "decision", "index": 1}]}',
        "Les deux tableaux peuvent être vides.",
      ].join("\n")
      const raw = await aiProvider.complete(prompt)
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) return { additions: [], removals: [] }
      let parsed: unknown
      try {
        parsed = JSON.parse(match[0])
      } catch {
        return { additions: [], removals: [] }
      }
      if (typeof parsed !== "object" || parsed === null) return { additions: [], removals: [] }
      const body = parsed as Record<string, unknown>

      // L'IA n'a pas de borne de longueur : on tronque ici pour que le compte rendu reste toujours accepté par `meeting:sendReport`.
      const additions = (Array.isArray(body.additions) ? body.additions : [])
        .filter((item): item is MeetingItemDraft => {
          if (typeof item !== "object" || item === null) return false
          const candidate = item as Record<string, unknown>
          return (
            (candidate.type === "decision" || candidate.type === "task") &&
            typeof candidate.text === "string" &&
            candidate.text.trim() !== ""
          )
        })
        .map((item): MeetingItemDraft => ({
          type: item.type,
          text: truncateMeetingText(item.text.trim()),
        }))

      const removals: MeetingItemRemoval[] = (Array.isArray(body.removals) ? body.removals : [])
        .filter((item): item is { type: MeetingItemType; index: number } => {
          if (typeof item !== "object" || item === null) return false
          const candidate = item as Record<string, unknown>
          if (candidate.type !== "decision" && candidate.type !== "task") return false
          if (typeof candidate.index !== "number") return false
          const list = candidate.type === "decision" ? decisions : tasks
          return candidate.index >= 1 && candidate.index <= list.length
        })
        // L'IA référence D1/T1 (1-based) ; `MeetingItemRemoval.index` est documenté 0-based pour matcher directement les tableaux côté renderer.
        .map((item) => ({ type: item.type, index: item.index - 1 }))

      return { additions, removals }
    },
  )

  ipcMain.handle("assistant:ask", async (_event, question: unknown): Promise<AssistantAnswer> => {
    const text = assertNonEmptyString(question, "question")

    let tickets: JiraTicketSummary[] = []
    let ticketsBlock = "Aucun ticket Jira disponible (Jira non connecté ou requête impossible)."
    try {
      tickets = await jira.searchOpenIssues()
      ticketsBlock =
        tickets.length > 0
          ? tickets.map((ticket) => `- ${ticket.key} [${ticket.status}] ${ticket.summary}`).join("\n")
          : "Aucun ticket ouvert actuellement dans les projets connectés."
    } catch (err) {
      // Jira non connecté ou requête échouée : BCC répond sans ce contexte plutôt que de bloquer.
      warnSourceUnavailable("assistant:ask", "tickets Jira", err)
    }

    // Réglage désactivé ou illisible : journal et décisions ne sont même pas lus.
    let activity: ActivityContext | null = null
    if (await shouldShareRecentActivity()) {
      const [journalEntries, decisions] = await Promise.allSettled([
        journal.listYesterday(),
        meetingDecisions.listRecent(),
      ])
      activity = {
        journal: settledOrUnavailable(journalEntries, "journal d'hier", selectRecentJournal),
        decisions: settledOrUnavailable(decisions, "décisions de réunion", selectRecentDecisions),
      }
    }

    const prompt = buildAskPrompt(text, ticketsBlock, activity)
    const rawAnswer = await aiProvider.complete(prompt)

    const citedKeys = new Set<string>()
    for (const match of rawAnswer.matchAll(/\[([A-Z][A-Z0-9]*-\d+)\]/g)) citedKeys.add(match[1])
    const relevantTickets = tickets.filter((ticket) => citedKeys.has(ticket.key))
    let cleanText = rawAnswer.replace(/\s*\[[A-Z][A-Z0-9]*-\d+\]/g, "")
    // Filet de sécurité si le modèle a quand même épelé la clé en clair malgré la consigne (elle serait sinon en double avec sa carte).
    for (const key of citedKeys) cleanText = cleanText.replace(new RegExp(`\\b${key}\\b\\s*`, "g"), "")
    cleanText = cleanText.replace(/[ \t]{2,}/g, " ").trim()

    return { text: cleanText, tickets: relevantTickets }
  })

  ipcMain.handle(
    "assistant:suggest",
    async (_event, query: unknown): Promise<AssistantSuggestion[]> => {
      if (typeof query !== "string") {
        throw new Error(`Paramètre "query" invalide.`)
      }
      const text = query.trim()
      if (text.length < ASSISTANT_SUGGEST_MIN_CHARS) return []
      if (text.length > ASSISTANT_SUGGEST_MAX_CHARS) {
        throw new Error(
          `Recherche trop longue (${ASSISTANT_SUGGEST_MAX_CHARS} caractères maximum).`,
        )
      }
      // Réglage désactivé ou illisible : journal et décisions ne sont même pas lus, seuls les tickets restent.
      const shareRecent = await shouldShareRecentActivity()
      // Le vocabulaire personnel est local : il n'est jamais transmis à l'IA. Un raccourci
      // appris sur une décision/un journal ne doit toutefois pas réapparaître quand le partage
      // est désactivé, sinon il contredirait le réglage.
      const shortcuts = await vocabulary.list().catch((error: unknown) => {
        warnSourceUnavailable("assistant:suggest", "vocabulaire personnel", error)
        return [] as PersonalShortcut[]
      })
      const allowedShortcuts = shareRecent
        ? shortcuts
        : shortcuts.filter((shortcut) => shortcut.kind === "ticket")

      if (!shareRecent) {
        // Le cache de tickets ne rejette jamais : un échec Jira y vaut déjà « source vide », signalé une fois.
        const matched = matchSuggestions(text, {
          tickets: await suggestTickets.get(),
          decisions: [],
          journal: [],
        })
        return mergeLearnedShortcuts(matched, learnedSuggestions(text, allowedShortcuts))
      }
      const [tickets, decisions, journalEntries] = await Promise.allSettled([
        suggestTickets.get(),
        meetingDecisions.listRecent(),
        journal.listYesterday(),
      ])
      // Mêmes fenêtres que `assistant:ask` : une suggestion proposée a toujours son contexte dans le prompt.
      const matched = matchSuggestions(text, {
        tickets: settledOrEmpty(tickets, "tickets"),
        decisions: selectRecentDecisions(settledOrEmpty(decisions, "décisions de réunion")),
        journal: selectRecentJournal(settledOrEmpty(journalEntries, "journal d'hier")),
      })
      return mergeLearnedShortcuts(matched, learnedSuggestions(text, allowedShortcuts))
    },
  )

  ipcMain.handle("privacy:get", (): Promise<PrivacySettings> => privacy.getSettings())
  ipcMain.handle(
    "privacy:setShareRecentActivity",
    (_event, enabled: unknown): Promise<PrivacySettings> => {
      // Booléen strict : ni "false", ni 0, ni undefined — rien n'est écrit sinon.
      if (typeof enabled !== "boolean") {
        return Promise.reject(new Error(`Paramètre "enabled" invalide : un booléen est attendu.`))
      }
      return privacy.setShareRecentActivity(enabled)
    },
  )

  // Vocabulaire personnel appris localement (contrat : docs/ipc/personal-vocabulary.md).
  ipcMain.handle("vocabulary:list", (): Promise<PersonalShortcut[]> => vocabulary.list())
  ipcMain.handle(
    "vocabulary:record",
    (_event, query: unknown, shortcut: unknown): Promise<PersonalShortcut> =>
      vocabulary.record(assertShortcutQuery(query), assertShortcutDraft(shortcut)),
  )
  ipcMain.handle("vocabulary:forget", (): Promise<void> => vocabulary.forget())

  // Pont d'automatisation navigateur : état de la liaison, et exécution des
  // recettes quand il y en aura (docs/ipc/browser-automation.md).
  const automationLogger = {
    info: (message: string) => console.log(`[browser-automation] ${message}`),
    warn: (message: string) => console.warn(`[browser-automation] ${message}`),
  }
  const browserAutomation = new BrowserAutomationBridge(browserAutomationSocketPath(), automationLogger)

  // Outil de maintenance, jamais actif en usage normal : relever la structure
  // de pages pour écrire les sélecteurs d'une recette, au lieu de les inventer
  // (contrat, §13). Ne s'active que si la variable est posée explicitement, et
  // accepte plusieurs préfixes séparés par des virgules.
  const reconPrefixes = (process.env["BYKO_RECON_URL_PREFIX"] ?? "")
    .split(",")
    .map((prefix) => normalizeUrlPrefix(prefix))
    .filter((prefix) => prefix !== "")
  const browserAutomationRecon =
    reconPrefixes.length > 0
      ? new BrowserAutomationRecon({
          bridge: { send: (message) => browserAutomation.sendToExtension(message) },
          logger: automationLogger,
          outputDir: app.getPath("userData"),
          urlPrefixes: reconPrefixes,
        })
      : null

  // Pilotage par IA (contrat, §3.3). Déclenché par l'environnement le temps de
  // l'éprouver ; le bouton « connexion auto » de l'interface viendra le
  // remplacer, sans changer cette mécanique.
  const agentGoal = process.env["BYKO_AGENT_GOAL"]
  const agentUrl = process.env["BYKO_AGENT_URL"] ?? ""
  let agentOrigin: string | null = null
  try {
    if (agentUrl !== "") agentOrigin = `${new URL(agentUrl).origin}/`
  } catch {
    automationLogger.warn(`BYKO_AGENT_URL illisible, pilotage désactivé : ${agentUrl}`)
  }
  const agent =
    agentGoal && agentOrigin
      ? new BrowserAutomationAgent({
          bridge: { send: (message) => browserAutomation.sendToExtension(message) },
          logger: automationLogger,
          complete: (prompt) => aiProvider.complete(prompt),
          goal: agentGoal,
          targetUrl: agentUrl,
          // Périmètre : l'origine de la page visée, et rien d'autre.
          allowedOrigins: [agentOrigin],
          applyCredentials: async (clientId, clientSecret) => {
            // Première étape : vérifier qu'on sait les lire. Le branchement réel
            // passe par `applyCapturedValues`, qui enchaîne le flux OAuth — c'est
            // là que l'utilisateur clique « Autoriser ».
            automationLogger.info(
              `identifiants lus (Client ID : ${clientId.length} caractères, Secret : ${clientSecret.length} caractères)`,
            )
          },
        })
      : null

  browserAutomation.onMessage = (message) => {
    if (browserAutomationRecon?.handleMessage(message)) return
    agent?.handleMessage(message)
  }
  browserAutomation.onConnected = () => {
    // L'extension peut se connecter après le démarrage : on attend qu'elle
    // s'annonce avant de lui demander quoi que ce soit.
    browserAutomationRecon?.start()
    if (agent) void agent.run()
  }

  browserAutomation.start()
  app.on("before-quit", () => browserAutomation.stop())

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
