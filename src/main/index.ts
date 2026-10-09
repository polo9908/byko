import { app, dialog, shell, BrowserWindow, ipcMain, systemPreferences } from "electron"
import { join } from "path"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import { isEncryptionAvailable } from "./secrets"
import * as jira from "./integrations/jira"
import * as aiProvider from "./integrations/ai-provider"
import * as figma from "./integrations/figma"
import * as github from "./integrations/github"
import * as ticketLinks from "./ticketLinks"
import * as linkSync from "./linkSync"
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
import * as notifications from "./notifications"
import * as profile from "./profile"
import * as glossary from "./glossary"
import * as memory from "./memory"
import { buildDigest } from "./digest"
import type { DailyDigest } from "../shared/digest"
import type { MemoryHit, MemoryState } from "../shared/memory"
import { MEMORY_QUERY_MIN } from "../shared/memory"
import type { GlossaryImportResult, GlossaryState } from "../shared/glossary"
import * as accounts from "./accounts"
import { getActiveAccountId, runWithActiveAccount } from "./accountPaths"
import type { AccountSummary } from "../shared/accounts"
import type { ProfileState } from "../shared/profile"
import type { NotificationResult } from "../shared/notifications"
import { AI_PROVIDERS } from "../shared/ai"
import type { AIProviderId } from "../shared/ai"
import { AUTONOMY_CATEGORY_IDS, AUTONOMY_MAX_LEVEL } from "../shared/autonomy"
import type { AutonomyCategoryId } from "../shared/autonomy"
import type {
  MeetingDecisionRecord,
  MeetingItemDraft,
  MeetingItemRemoval,
  MeetingItemUpdate,
  MeetingItemType,
  MeetingExtraction,
} from "../shared/meeting"
import { MEETING_ITEM_MAX_CHARS, MEETING_REPORT_MAX_ITEMS } from "../shared/meeting"
import type { AssistantAnswer, AssistantSuggestion } from "../shared/assistant"
import { ASSISTANT_SUGGEST_MAX_CHARS, ASSISTANT_SUGGEST_MIN_CHARS } from "../shared/assistant"
import type { JiraTicketSummary } from "../shared/jira"
import { LINKS_INPUT_MAX_CHARS, isIssueKey } from "../shared/links"
import type { LinkEvent, LinksState } from "../shared/links"
import { GOOGLE_CALENDAR_SETUP_PAGES } from "../shared/googleCalendar"
import type { GoogleCalendarSetupPage } from "../shared/googleCalendar"
import { CONNECTOR_SETUP_PAGES } from "../shared/connectors"
import type { ConnectorSetupPage } from "../shared/connectors"

/** Validation stricte des payloads reçus par IPC avant de les transmettre aux intégrations. */
const MAX_MEETING_ATTENDEES = 30
const MAX_ATTENDEE_NAME_CHARS = 60

/** Prénoms des présents envoyés par le renderer : bornés et nettoyés (jamais d'adresse), sinon ignorés sans échec. */
function assertAttendeeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.replace(/[\r\n"]+/g, " ").trim().slice(0, MAX_ATTENDEE_NAME_CHARS))
    .filter((name) => /\p{L}/u.test(name) && !name.includes("@"))
    .slice(0, MAX_MEETING_ATTENDEES)
}

/** Consigne « qui fait quoi » : seuls des prénoms partent vers l'IA, avec la transcription qui les contient déjà. */
function attendeesPromptLines(value: unknown, forItems = false): string[] {
  const names = assertAttendeeNames(value)
  if (names.length === 0) return []
  return [
    "",
    `Personnes présentes (prénoms) : ${names.join(", ")}.`,
    forItems
      ? "Quand une décision ou une tâche est attribuée à l'une d'elles dans la transcription, commence son texte par ce prénom, écrit exactement comme dans la liste (ex. « Sarah envoie le devis »). N'attribue personne si personne n'est nommé, et n'invente jamais de prénom."
      : "Quand quelqu'un de cette liste est nommé pour faire quelque chose, écris-le avec son prénom exact (ex. « Sarah envoie le devis »). N'attribue rien si personne n'est nommé.",
  ]
}

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

function assertIssueKey(value: unknown): string {
  if (!isIssueKey(value)) throw new Error(`Paramètre "issueKey" invalide.`)
  return value
}

function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Paramètre "${name}" invalide.`)
  return value
}

/** Saisie libre courte (nom de dépôt, lien de fichier Figma) : le format fin est validé par l'intégration. */
function assertLinkInput(value: unknown, name: string): string {
  const text = assertString(value, name, LINKS_INPUT_MAX_CHARS).trim()
  if (text === "") throw new Error(`Paramètre "${name}" invalide.`)
  return text
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
function settledOrEmpty<T>(result: PromiseSettledResult<T[]>, source: string, channel = "assistant:suggest"): T[] {
  if (result.status === "fulfilled") return result.value
  warnSourceUnavailable(channel, source, result.reason)
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

/**
 * Point de passage unique vers le fournisseur d'IA : l'interrupteur « Utiliser l'IA » (Réglages) est relu à chaque appel.
 * Fail-closed : réglage illisible = IA désactivée. Aucune requête n'est envoyée au fournisseur si elle l'est (le contexte local
 * — Jira, journal — peut avoir été lu en amont par l'appelant).
 */
async function completeWithAi(prompt: string): Promise<string> {
  let enabled = false
  try {
    enabled = (await privacy.getSettings()).aiEnabled
  } catch (error) {
    warnSourceUnavailable("privacy", "réglage de confidentialité", error)
  }
  if (!enabled) throw new Error("L'IA est désactivée dans les Réglages.")
  return aiProvider.complete(prompt)
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

/** Relève des pull requests, maquettes et releases (voir linkSync.ts). */
const LINK_SYNC_FIRST_DELAY_MS = 20_000
const LINK_SYNC_INTERVAL_MS = 5 * 60_000

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
    // Liens issus de données externes (invitations, tickets) : jamais de `file:`, `javascript:` ou schéma applicatif.
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.byko.app")
  // Avant toute lecture de secret ou de donnée : le compte actif (et la migration d'une installation d'avant les comptes).
  try {
    await accounts.initAccounts()
  } catch (error) {
    dialog.showErrorBox("BYKO", error instanceof Error ? error.message : "Impossible d'ouvrir les comptes.")
    app.quit()
    return
  }
  // Chaque appel IPC retient le compte actif au moment où il démarre : une opération lente qui se termine après un
  // changement de compte écrit dans SON compte, jamais dans le nouveau (voir accountPaths.ts).
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    originalHandle(channel, (event, ...args) => runWithActiveAccount(() => listener(event, ...args)))

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

  // Comptes locaux (docs/ipc/accounts.md). Après chaque changement, la fenêtre se recharge : plus rien de l'ancien compte
  // ne reste ni dans l'interface ni dans les caches de main.
  accounts.onActiveAccountChange(() => {
    suggestTickets.invalidate()
    notifications.closeAll()
    try {
      googleCalendar.cancelConnect()
    } catch {
      // Aucune connexion Google en cours : rien à annuler.
    }
  })
  const reloadSoon = (sender: Electron.WebContents): void => {
    setTimeout(() => {
      if (!sender.isDestroyed()) sender.reloadIgnoringCache()
    }, 0)
  }
  ipcMain.handle("accounts:list", (): Promise<AccountSummary[]> => accounts.listAccounts())
  ipcMain.handle("accounts:switch", async (event, id: unknown): Promise<void> => {
    await accounts.switchAccount(accounts.assertKnownAccount(id))
    reloadSoon(event.sender)
  })
  ipcMain.handle("accounts:add", async (event): Promise<void> => {
    await accounts.addAccount()
    reloadSoon(event.sender)
  })
  ipcMain.handle("accounts:logout", async (event): Promise<void> => {
    await accounts.logout()
    reloadSoon(event.sender)
  })
  ipcMain.handle("accounts:remove", async (event, id: unknown): Promise<void> => {
    await accounts.removeAccount(accounts.assertKnownAccount(id))
    reloadSoon(event.sender)
  })

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
        const status = await jira.connect(validDomain, validEmail, validToken)
        // Prénom et nom du profil Jira, pour le menu de profil (échec sans conséquence : un nom déduit de l'e-mail est affiché).
        if (status.displayName) await profile.saveName(status.displayName).catch(() => undefined)
        return status
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
  // Les tickets créés en réunion sont suivis pour la liaison automatique (docs/ipc/ticket-links.md). Le suivi est
  // tenu ici, pas dans le renderer, et son échec ne fait jamais échouer l'action Jira elle-même.
  const warnTracking = (error: unknown): void =>
    console.warn("[links] suivi du ticket non mis à jour :", error instanceof Error ? error.message : "erreur inconnue")
  ipcMain.handle("jira:createIssue", async (_event, summary: unknown) => {
    const ticket = await jira.createIssue(assertNonEmptyString(summary, "summary"))
    await ticketLinks.track({ issueKey: ticket.key, url: ticket.url, summary: ticket.summary }).catch(warnTracking)
    return ticket
  })
  ipcMain.handle("jira:updateIssueSummary", async (_event, issueKey: unknown, summary: unknown) => {
    const key = assertNonEmptyString(issueKey, "issueKey")
    const text = assertNonEmptyString(summary, "summary")
    await jira.updateIssueSummary(key, text)
    await ticketLinks.updateSummary(key, text).catch(warnTracking)
  })
  ipcMain.handle("jira:deleteIssue", async (_event, issueKey: unknown) => {
    const key = assertNonEmptyString(issueKey, "issueKey")
    await jira.deleteIssue(key)
    await ticketLinks.untrack(key).catch(warnTracking)
  })
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

  ipcMain.handle("github:openTokenPage", () => github.openTokenPage())
  ipcMain.handle("github:getStatus", () => github.getStatus())
  ipcMain.handle("github:disconnect", () => github.disconnect())
  ipcMain.handle("github:connect", (_event, token: unknown) => github.connect(assertNonEmptyString(token, "token")))

  // Liaison ticket ↔ pull request ↔ maquette ↔ release (docs/ipc/ticket-links.md).
  const broadcastLinkEvents = (events: LinkEvent[]): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!notifications.isToast(window)) window.webContents.send("links:updated", events)
    }
  }
  /** Les évènements ne partent vers la fenêtre que si le compte du passage est toujours le compte affiché. */
  // Deux demandes pendant un même passage reçoivent le même résultat : il n'est diffusé qu'une fois.
  const broadcastPasses = new WeakSet<LinkEvent[]>()
  const syncLinks = async (): Promise<void> => {
    const accountId = getActiveAccountId()
    const events = await linkSync.syncNow()
    if (accountId !== getActiveAccountId() || broadcastPasses.has(events)) return
    broadcastPasses.add(events)
    broadcastLinkEvents(events)
  }
  ipcMain.handle("links:getState", (): Promise<LinksState> => ticketLinks.getState())
  ipcMain.handle("links:sync", async (): Promise<LinksState> => {
    await syncLinks()
    return ticketLinks.getState()
  })
  ipcMain.handle("links:addRepo", async (_event, repo: unknown): Promise<LinksState> => {
    const name = await github.verifyRepo(github.assertRepoName(assertLinkInput(repo, "repo")))
    return ticketLinks.addRepo({ forge: "github", name })
  })
  ipcMain.handle("links:removeRepo", (_event, repo: unknown): Promise<LinksState> =>
    ticketLinks.removeRepo(assertLinkInput(repo, "repo")),
  )
  ipcMain.handle("links:addFigmaFile", async (_event, file: unknown): Promise<LinksState> => {
    const key = figma.assertFileKey(assertLinkInput(file, "file"))
    return ticketLinks.addFigmaFile({ key, name: await figma.fetchFileName(key) })
  })
  ipcMain.handle("links:removeFigmaFile", (_event, key: unknown): Promise<LinksState> =>
    ticketLinks.removeFigmaFile(assertLinkInput(key, "key")),
  )
  ipcMain.handle("links:resolveTransition", (_event, issueKey: unknown, accept: unknown): Promise<LinksState> =>
    linkSync.resolveTransition(assertIssueKey(issueKey), assertBoolean(accept, "accept")),
  )
  // Pas de serveur, donc pas de webhook : relève périodique tant que l'app est ouverte et qu'un compte est connecté.
  const scheduledLinkSync = (): void => {
    if (getActiveAccountId() === null) return
    runWithActiveAccount(() => syncLinks()).catch((error: unknown) =>
      console.warn("[links] synchronisation impossible :", error instanceof Error ? error.message : "erreur inconnue"),
    )
  }
  setTimeout(scheduledLinkSync, LINK_SYNC_FIRST_DELAY_MS)
  setInterval(scheduledLinkSync, LINK_SYNC_INTERVAL_MS)

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
    } else if (entry.undo.type === "jira-remote-link") {
      await jira.deleteRemoteLink(entry.undo.issueKey, entry.undo.linkId)
      // Sans ça, la synchronisation suivante reposerait le lien.
      await ticketLinks.dismiss(entry.undo.issueKey, entry.undo.globalId)
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
  ipcMain.handle("speech:getStatus", () => speech.getStatus())
  speech.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("speech:status", status)
  })
  ipcMain.handle("speech:transcribe", (_event, audio: unknown) => {
    if (!(audio instanceof Float32Array) || audio.length === 0) {
      throw new Error(`Paramètre "audio" invalide.`)
    }
    if (audio.length > speech.SAMPLE_RATE * speech.MAX_AUDIO_SECONDS) {
      throw new Error(`Enregistrement trop long (${speech.MAX_AUDIO_SECONDS} s maximum).`)
    }
    // Vocabulaire de réunion : erreurs de transcription connues corrigées (« dev ops » → « DevOps »), jamais d'échec ici.
    return speech.transcribe(audio).then((text) => (text ? glossary.correct(text) : text))
  })

  ipcMain.handle("meeting:summarize", async (_event, transcript: unknown, attendees?: unknown) => {
    const text = assertNonEmptyString(transcript, "transcript")
    const teamVocabulary = await glossary.promptBlock(text)
    const prompt = [
      "Voici la transcription d'un point d'équipe (réunion courte).",
      "Rédige un compte rendu court en français, 3 à 5 puces maximum,",
      "des sujets et décisions abordés. Pas d'introduction, juste les puces.",
      ...attendeesPromptLines(attendees),
      "",
      ...(teamVocabulary ? [teamVocabulary, ""] : []),
      "Transcription :",
      text,
    ].join("\n")
    return completeWithAi(prompt)
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
      attendees?: unknown,
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
      // Abréviations et expressions de l'équipe présentes dans la transcription (base livrée + liste de l'utilisateur).
      const teamVocabulary = await glossary.promptBlock(text)

      const prompt = [
        "Voici la transcription d'un point d'équipe, telle qu'entendue jusqu'à présent (elle est issue d'une",
        "reconnaissance vocale : elle peut contenir des fautes, des hésitations, des répétitions) :",
        '"""',
        text,
        '"""',
        "",
        ...(teamVocabulary ? [teamVocabulary, ""] : []),
        ...attendeesPromptLines(attendees, true),
        "Décisions déjà notées (D1 = la plus ancienne) :",
        numbered(decisions, "D"),
        "",
        "Tâches déjà notées (T1 = la plus ancienne ; chacune est en train de devenir, ou est déjà, un ticket Jira) :",
        numbered(tasks, "T"),
        "",
        rejected.length
          ? `Éléments abandonnés pour de bon plus tôt — ne les repropose JAMAIS, même reformulés : ${rejected.join(" / ")}`
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
        "Ne note que ce qui est ACTÉ. Une hypothèse, une question, une idée lancée sans accord (« et si on… ? »,",
        "« peut-être qu'on pourrait… », « je me demande si… ») n'est ni une décision ni une tâche tant que",
        "l'équipe ne l'a pas validée.",
        "",
        "PRINCIPE DE REGROUPEMENT : une task = un livrable cohérent (un écran, une modale, une fonctionnalité,",
        "un bug). Plusieurs modifications sur le MÊME objet forment UNE seule task dont le texte les énumère",
        "(ex. « Modale Réglages : ajouter l'onglet Confidentialité, griser le bouton Enregistrer tant que le",
        "formulaire est invalide et corriger l'espacement »). Si une task déjà notée porte sur ce même objet,",
        "ENRICHIS-LA (updates) au lieu d'en ajouter une nouvelle. Des objets distincts restent des tasks distinctes.",
        "",
        "La réunion revient souvent sur ce qui vient d'être dit. Tiens compte de TOUS ces cas, en lisant la",
        "transcription dans l'ordre et en t'aidant du contexte (« le dernier », « celui-là », « ce qu'on vient",
        "de dire », « tout ça » désignent les éléments qui viennent d'être notés, pas n'importe lesquels) :",
        "- Annulation (« en fait non », « laisse tomber », « on ne le fait pas », « oublie le dernier ») →",
        '  removal avec "reason":"cancelled" (l\'élément ne reviendra pas).',
        "- Regroupement (« on met tout ça dans un seul ticket », « fusionne ces deux », « c'est la même chose ») →",
        "  UN update sur l'élément conservé (le plus ancien concerné, pour garder son ticket) avec un texte qui",
        '  réunit TOUT le contenu des éléments regroupés, et un removal "reason":"replaced" pour chacun des autres.',
        "  « Tout ce qu'on vient d'énumérer » = toutes les tasks notées depuis le début du sujet en cours ;",
        "  dans le doute, ce sont celles qui portent sur le même objet ou qui ont été notées juste avant.",
        "- Correction (« non pas X, plutôt Y », « en fait c'est vendredi », « pas le bouton, le champ ») →",
        "  update sur l'élément concerné, avec le texte corrigé.",
        "- Précision ou ajout sur un élément existant (« et aussi pour ça… », « avec un message d'erreur ») →",
        "  update qui complète le texte existant.",
        '- Éclatement (« sépare ça en deux », « il faut deux tickets ») → removal "replaced" de l\'élément',
        "  d'origine et additions pour chaque partie.",
        "- Changement de nature ou de sujet (une task devient une decision, ou l'inverse) → removal",
        '  "replaced" de l\'ancien et addition du nouveau.',
        '- Reprise d\'une décision (« on revient sur… ») → update si elle est modifiée, removal "cancelled" si abandonnée.',
        "",
        "Pour chaque update ou removal, réfère-toi à l'élément par son numéro exact (D1, T2…) et UNIQUEMENT aux",
        "éléments des listes ci-dessus. Ne touche pas à un élément que la suite n'évoque pas. Un texte d'update",
        "est la version FINALE complète de l'élément (jamais un simple ajout), court, sans nom inventé.",
        "N'invente rien : base-toi STRICTEMENT sur ce qui est exprimé. Une additions ne doit jamais dupliquer",
        "un élément déjà noté ou abandonné.",
        "",
        "Réponds STRICTEMENT en JSON, sans texte autour, exactement sous cette forme :",
        '{"additions": [{"type": "task", "text": "..."}],',
        ' "updates": [{"type": "task", "index": 1, "text": "..."}],',
        ' "removals": [{"type": "task", "index": 2, "reason": "replaced"}]}',
        "Les trois tableaux peuvent être vides.",
      ].join("\n")
      const raw = await completeWithAi(prompt)
      const empty: MeetingExtraction = { additions: [], removals: [], updates: [] }
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) return empty
      let parsed: unknown
      try {
        parsed = JSON.parse(match[0])
      } catch {
        return empty
      }
      if (typeof parsed !== "object" || parsed === null) return empty
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

      // L'IA référence D1/T1 (1-based) ; les index renvoyés sont 0-based pour matcher directement les tableaux côté renderer.
      const refOf = (candidate: Record<string, unknown>): { type: MeetingItemType; index: number } | null => {
        if (candidate.type !== "decision" && candidate.type !== "task") return null
        if (typeof candidate.index !== "number" || !Number.isInteger(candidate.index)) return null
        const list = candidate.type === "decision" ? decisions : tasks
        if (candidate.index < 1 || candidate.index > list.length) return null
        return { type: candidate.type, index: candidate.index - 1 }
      }
      const seen = new Set<string>()
      const removals: MeetingItemRemoval[] = []
      for (const item of Array.isArray(body.removals) ? body.removals : []) {
        if (typeof item !== "object" || item === null) continue
        const candidate = item as Record<string, unknown>
        const ref = refOf(candidate)
        if (!ref) continue
        const key = `${ref.type}:${ref.index}`
        if (seen.has(key)) continue
        seen.add(key)
        // Sans précision, on suppose l'abandon (le comportement d'avant) : mieux vaut ne pas reproposer que reproposer.
        removals.push({ ...ref, reason: candidate.reason === "replaced" ? "replaced" : "cancelled" })
      }
      const updates: MeetingItemUpdate[] = []
      const updated = new Set<string>()
      for (const item of Array.isArray(body.updates) ? body.updates : []) {
        if (typeof item !== "object" || item === null) continue
        const candidate = item as Record<string, unknown>
        const ref = refOf(candidate)
        if (!ref || typeof candidate.text !== "string" || candidate.text.trim() === "") continue
        const key = `${ref.type}:${ref.index}`
        // Un élément supprimé dans la même réponse n'est pas réécrit, et un seul update par élément.
        if (seen.has(key) || updated.has(key)) continue
        updated.add(key)
        updates.push({ ...ref, text: truncateMeetingText(candidate.text.trim()) })
      }

      return { additions, removals, updates }
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
    const rawAnswer = await completeWithAi(prompt)

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

  ipcMain.handle("privacy:setAiEnabled", (_event, enabled: unknown): Promise<PrivacySettings> => {
    if (typeof enabled !== "boolean") {
      return Promise.reject(new Error(`Paramètre "enabled" invalide : un booléen est attendu.`))
    }
    return privacy.setAiEnabled(enabled)
  })

  // Profil local : e-mail et fin de l'assistant de démarrage, pour ne plus rien redemander (docs/ipc/profile.md).
  ipcMain.handle("profile:get", (): Promise<ProfileState> => profile.getProfile())
  ipcMain.handle("profile:saveEmail", (_event, email: unknown): Promise<void> => profile.saveEmail(profile.assertEmail(email)))
  ipcMain.handle("profile:saveRole", (_event, role: unknown): Promise<void> => profile.saveRole(profile.assertRole(role)))
  ipcMain.handle("profile:completeOnboarding", (): Promise<void> => profile.completeOnboarding())

  // Vocabulaire de réunion : base livrée + liste de l'utilisateur (docs/ipc/glossary.md).
  ipcMain.handle("glossary:get", (): Promise<GlossaryState> => glossary.getState())
  ipcMain.handle("glossary:setBuiltinEnabled", (_event, enabled: unknown): Promise<GlossaryState> => {
    if (typeof enabled !== "boolean") {
      return Promise.reject(new Error(`Paramètre "enabled" invalide : un booléen est attendu.`))
    }
    return glossary.setBuiltinEnabled(enabled)
  })
  ipcMain.handle("glossary:add", (_event, draft: unknown): Promise<GlossaryState> =>
    glossary.addEntry(glossary.assertDraft(draft)),
  )
  ipcMain.handle("glossary:remove", (_event, id: unknown): Promise<GlossaryState> =>
    glossary.removeEntry(glossary.assertEntryId(id)),
  )
  ipcMain.handle(
    "glossary:import",
    (_event, text: unknown): Promise<{ state: GlossaryState; result: GlossaryImportResult }> =>
      glossary.importText(glossary.assertImportText(text)),
  )

  // Mémoire d'équipe : registre des décisions, propositions issues des réunions, recherche (docs/ipc/team-memory.md).
  // Les décisions de réunion illisibles n'empêchent pas de consulter le registre : pas de proposition pour cet appel.
  const meetingRecordsOrEmpty = (): Promise<MeetingDecisionRecord[]> =>
    meetingDecisions.listRecent().catch((error: unknown) => {
      warnSourceUnavailable("memory", "décisions de réunion", error)
      return []
    })
  ipcMain.handle("memory:get", async (): Promise<MemoryState> => memory.getState(await meetingRecordsOrEmpty()))
  ipcMain.handle("memory:save", async (_event, draft: unknown): Promise<MemoryState> => {
    const valid = memory.assertDraft(draft)
    return memory.saveDecision(valid, await meetingRecordsOrEmpty())
  })
  ipcMain.handle("memory:remove", async (_event, id: unknown): Promise<MemoryState> => {
    const valid = memory.assertId(id)
    return memory.removeDecision(valid, await meetingRecordsOrEmpty())
  })
  ipcMain.handle("memory:dismissProposal", async (_event, id: unknown): Promise<MemoryState> => {
    const valid = memory.assertId(id)
    return memory.dismissProposal(valid, await meetingRecordsOrEmpty())
  })
  // Recherche locale, sans IA : une source en échec vaut « vide » pour cet appel, les autres répondent.
  ipcMain.handle("memory:search", async (_event, query: unknown): Promise<MemoryHit[]> => {
    const text = memory.assertQuery(query)
    if (text.length < MEMORY_QUERY_MIN) return []
    const [decisions, meetingRecords, terms, tickets, tracked] = await Promise.allSettled([
      memory.listDecisions(),
      meetingDecisions.listRecent(),
      glossary.listTerms(),
      suggestTickets.get(),
      ticketLinks.getState().then((state) => state.tickets),
    ])
    return memory.searchMemory(text, {
      decisions: settledOrEmpty(decisions, "décisions consignées", "memory:search"),
      meetingRecords: settledOrEmpty(meetingRecords, "décisions de réunion", "memory:search"),
      terms: settledOrEmpty(terms, "vocabulaire", "memory:search"),
      tickets: settledOrEmpty(tickets, "tickets", "memory:search"),
      tracked: settledOrEmpty(tracked, "liens de tickets", "memory:search"),
    })
  })
  // Question en langage naturel : les décisions consignées sont envoyées au fournisseur d'IA de l'utilisateur, à sa demande.
  // Celles relevées en réunion suivent le réglage « activité récente » (fail-closed), comme pour `assistant:ask`.
  ipcMain.handle("memory:ask", async (_event, question: unknown): Promise<string> => {
    const text = memory.assertQuery(question)
    if (text.length < MEMORY_QUERY_MIN) throw new Error("Question trop courte.")
    const decisions = await memory.listDecisions()
    const meetingRecords = (await shouldShareRecentActivity()) ? await meetingRecordsOrEmpty() : null
    const prompt = memory.buildMemoryPrompt(text, decisions, meetingRecords, await glossary.promptBlock(text))
    return (await completeWithAi(prompt)).trim()
  })

  // Digest de la vue journée (docs/ipc/digest.md) : une source en échec vaut « rien à signaler de ce côté » pour cet appel.
  ipcMain.handle("digest:get", async (): Promise<DailyDigest> => {
    const [role, issues, proposals, tracked] = await Promise.allSettled([
      profile.getRole(),
      jira.searchAttentionIssues(),
      meetingRecordsOrEmpty().then(async (records) => (await memory.getState(records)).proposals),
      ticketLinks.getState().then((state) => state.tickets),
    ])
    return buildDigest(role.status === "fulfilled" ? role.value : undefined, {
      issues: settledOrEmpty(issues, "tickets Jira", "digest:get"),
      proposals: settledOrEmpty(proposals, "décisions à consigner", "digest:get").length,
      tracked: settledOrEmpty(tracked, "liens de tickets", "digest:get"),
    })
  })

  // Notifications en bas à droite (contrat : docs/ipc/notifications.md).
  ipcMain.handle(
    "notifications:show",
    (_event, payload: unknown): NotificationResult => notifications.show(notifications.assertPayload(payload)),
  )
  ipcMain.handle(
    "notifications:test",
    (_event, durationSeconds: unknown, options: unknown): NotificationResult =>
      notifications.test(notifications.assertDuration(durationSeconds), notifications.assertTestOptions(options)),
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
          complete: (prompt) => completeWithAi(prompt),
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

  // Clic sur une notification : on ramène BYKO au premier plan (fenêtre recréée si elle avait été fermée) puis le renderer ouvre la page liée.
  notifications.setOpenHandler((target) => {
    let window = BrowserWindow.getAllWindows().find((candidate) => !notifications.isToast(candidate))
    if (!window) {
      createWindow()
      window = BrowserWindow.getAllWindows().find((candidate) => !notifications.isToast(candidate))
    }
    if (!window) return
    const appWindow = window
    if (appWindow.isMinimized()) appWindow.restore()
    appWindow.show()
    appWindow.focus()
    app.focus({ steal: true })
    if (appWindow.webContents.isLoading()) {
      appWindow.webContents.once("did-finish-load", () => appWindow.webContents.send("notifications:open", target))
    } else {
      appWindow.webContents.send("notifications:open", target)
    }
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
