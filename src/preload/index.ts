import { contextBridge, ipcRenderer, webFrame } from "electron"
import type { JiraConnectionStatus, JiraProjectSummary, JiraTicketSummary } from "../shared/jira"
import type { AIConnectionStatus, AIProviderId } from "../shared/ai"
import type { FigmaConnectionStatus } from "../shared/figma"
import type { GithubConnectionStatus, LinkEvent, LinksState } from "../shared/links"
import type {
  GoogleCalendarConnectionStatus,
  CalendarEventSummary,
  GoogleCalendarCredentialsStatus,
  GoogleCalendarSetupPage,
} from "../shared/googleCalendar"
import type { ConnectorSetupPage, ConnectorSummary } from "../shared/connectors"
import type { JournalEntry } from "../shared/journal"
import type { AutonomyCategory, AutonomyCategoryId } from "../shared/autonomy"
import type { MeetingExtraction, MeetingItemDraft } from "../shared/meeting"
import type { AssistantAnswer, AssistantSuggestion } from "../shared/assistant"
import type { PrivacySettings } from "../shared/privacy"
import type { AccountSummary } from "../shared/accounts"
import type { GlossaryDraft, GlossaryImportResult, GlossaryState } from "../shared/glossary"
import type { DecisionDraft, MemoryHit, MemoryState } from "../shared/memory"
import type { DailyDigest } from "../shared/digest"
import type { ProfileRole, ProfileState } from "../shared/profile"
import { isNotificationTarget } from "../shared/notifications"
import type {
  NotificationDuration,
  NotificationPayload,
  NotificationResult,
  NotificationTarget,
} from "../shared/notifications"
import type { SpeechModelStatus } from "../shared/speech"
import type { PersonalShortcut, ShortcutDraft } from "../shared/vocabulary"

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:getVersion"),
  secrets: {
    isEncryptionAvailable: (): Promise<boolean> => ipcRenderer.invoke("secrets:isEncryptionAvailable"),
  },
  jira: {
    openTokenPage: (): Promise<void> => ipcRenderer.invoke("jira:openTokenPage"),
    getStatus: (): Promise<JiraConnectionStatus> => ipcRenderer.invoke("jira:getStatus"),
    connect: (domain: string, email: string, apiToken: string): Promise<JiraConnectionStatus> =>
      ipcRenderer.invoke("jira:connect", domain, email, apiToken),
    disconnect: (): Promise<void> => ipcRenderer.invoke("jira:disconnect"),
    listProjects: (): Promise<JiraProjectSummary[]> => ipcRenderer.invoke("jira:listProjects"),
    countOpenIssues: (): Promise<number> => ipcRenderer.invoke("jira:countOpenIssues"),
    searchOpenIssues: (): Promise<JiraTicketSummary[]> => ipcRenderer.invoke("jira:searchOpenIssues"),
    setDefaultProject: (projectKey: string): Promise<void> => ipcRenderer.invoke("jira:setDefaultProject", projectKey),
    createIssue: (summary: string): Promise<JiraTicketSummary> => ipcRenderer.invoke("jira:createIssue", summary),
    updateIssueSummary: (issueKey: string, summary: string): Promise<void> =>
      ipcRenderer.invoke("jira:updateIssueSummary", issueKey, summary),
    deleteIssue: (issueKey: string): Promise<void> => ipcRenderer.invoke("jira:deleteIssue", issueKey),
    getTicket: (issueKey: string): Promise<JiraTicketSummary> => ipcRenderer.invoke("jira:getTicket", issueKey),
    postComment: (issueKey: string, body: string): Promise<{ id: string }> =>
      ipcRenderer.invoke("jira:postComment", issueKey, body),
    deleteComment: (issueKey: string, commentId: string): Promise<void> =>
      ipcRenderer.invoke("jira:deleteComment", issueKey, commentId),
  },
  ai: {
    getStatus: (): Promise<AIConnectionStatus> => ipcRenderer.invoke("ai:getStatus"),
    openKeyPage: (provider: AIProviderId): Promise<void> => ipcRenderer.invoke("ai:openKeyPage", provider),
    useDetectedKey: (provider: AIProviderId): Promise<AIConnectionStatus> =>
      ipcRenderer.invoke("ai:useDetectedKey", provider),
    setCustomKey: (provider: AIProviderId, key: string): Promise<AIConnectionStatus> =>
      ipcRenderer.invoke("ai:setCustomKey", provider, key),
    disconnect: (provider: AIProviderId): Promise<void> => ipcRenderer.invoke("ai:disconnect", provider),
  },
  figma: {
    openTokenPage: (): Promise<void> => ipcRenderer.invoke("figma:openTokenPage"),
    getStatus: (): Promise<FigmaConnectionStatus> => ipcRenderer.invoke("figma:getStatus"),
    connect: (token: string): Promise<FigmaConnectionStatus> => ipcRenderer.invoke("figma:connect", token),
    disconnect: (): Promise<void> => ipcRenderer.invoke("figma:disconnect"),
  },
  github: {
    openTokenPage: (): Promise<void> => ipcRenderer.invoke("github:openTokenPage"),
    getStatus: (): Promise<GithubConnectionStatus> => ipcRenderer.invoke("github:getStatus"),
    connect: (token: string): Promise<GithubConnectionStatus> => ipcRenderer.invoke("github:connect", token),
    disconnect: (): Promise<void> => ipcRenderer.invoke("github:disconnect"),
  },
  /** Liaison ticket ↔ pull request ↔ maquette ↔ release (docs/ipc/ticket-links.md). */
  links: {
    getState: (): Promise<LinksState> => ipcRenderer.invoke("links:getState"),
    sync: (): Promise<LinksState> => ipcRenderer.invoke("links:sync"),
    addRepo: (repo: string): Promise<LinksState> => ipcRenderer.invoke("links:addRepo", repo),
    removeRepo: (repo: string): Promise<LinksState> => ipcRenderer.invoke("links:removeRepo", repo),
    addFigmaFile: (file: string): Promise<LinksState> => ipcRenderer.invoke("links:addFigmaFile", file),
    removeFigmaFile: (key: string): Promise<LinksState> => ipcRenderer.invoke("links:removeFigmaFile", key),
    resolveTransition: (issueKey: string, accept: boolean): Promise<LinksState> =>
      ipcRenderer.invoke("links:resolveTransition", issueKey, accept),
    /** Une synchronisation vient de se terminer ; renvoie la fonction de désabonnement. Le `event` brut n'est jamais exposé. */
    onUpdated: (listener: (events: LinkEvent[]) => void): (() => void) => {
      const handler = (_event: unknown, events: unknown): void => {
        if (Array.isArray(events)) listener(events as LinkEvent[])
      }
      ipcRenderer.on("links:updated", handler)
      return () => ipcRenderer.removeListener("links:updated", handler)
    },
  },
  calendar: {
    connect: (): Promise<GoogleCalendarConnectionStatus> => ipcRenderer.invoke("calendar:connect"),
    getStatus: (): Promise<GoogleCalendarConnectionStatus> => ipcRenderer.invoke("calendar:getStatus"),
    disconnect: (): Promise<void> => ipcRenderer.invoke("calendar:disconnect"),
    listTodayEvents: (): Promise<CalendarEventSummary[]> => ipcRenderer.invoke("calendar:listTodayEvents"),
    getCredentialsStatus: (): Promise<GoogleCalendarCredentialsStatus> =>
      ipcRenderer.invoke("calendar:getCredentialsStatus"),
    openSetupPage: (page: GoogleCalendarSetupPage): Promise<void> => ipcRenderer.invoke("calendar:openSetupPage", page),
    connectWithCredentials: (clientId: string, clientSecret: string): Promise<GoogleCalendarConnectionStatus> =>
      ipcRenderer.invoke("calendar:connectWithCredentials", clientId, clientSecret),
    cancelConnect: (): Promise<void> => ipcRenderer.invoke("calendar:cancelConnect"),
  },
  settings: {
    listConnectors: (): Promise<ConnectorSummary[]> => ipcRenderer.invoke("settings:listConnectors"),
    openSetupPage: (page: ConnectorSetupPage): Promise<void> => ipcRenderer.invoke("connectors:openSetupPage", page),
  },
  journal: {
    listToday: (): Promise<JournalEntry[]> => ipcRenderer.invoke("journal:listToday"),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke("journal:cancel", id),
  },
  autonomy: {
    list: (): Promise<AutonomyCategory[]> => ipcRenderer.invoke("autonomy:list"),
    setLevel: (id: AutonomyCategoryId, level: number): Promise<AutonomyCategory[]> =>
      ipcRenderer.invoke("autonomy:setLevel", id, level),
  },
  meeting: {
    requestMicAccess: (): Promise<boolean> => ipcRenderer.invoke("meeting:requestMicAccess"),
    summarize: (transcript: string, attendees: string[] = []): Promise<string> =>
      ipcRenderer.invoke("meeting:summarize", transcript, attendees),
    sendReport: (reportId: string, items: MeetingItemDraft[]): Promise<void> =>
      ipcRenderer.invoke("meeting:sendReport", reportId, items),
    extractItems: (
      transcript: string,
      existingDecisions: string[],
      existingTasks: string[],
      rejectedTexts: string[],
      attendees: string[] = [],
    ): Promise<MeetingExtraction> =>
      ipcRenderer.invoke("meeting:extractItems", transcript, existingDecisions, existingTasks, rejectedTexts, attendees),
  },
  speech: {
    prepare: (): Promise<void> => ipcRenderer.invoke("speech:prepare"),
    getStatus: (): Promise<SpeechModelStatus> => ipcRenderer.invoke("speech:getStatus"),
    /** Abonnement à l'état du modèle ; renvoie la fonction de désabonnement. Le `event` brut n'est jamais exposé. */
    onStatus: (listener: (status: SpeechModelStatus) => void): (() => void) => {
      const handler = (_event: unknown, status: SpeechModelStatus): void => listener(status)
      ipcRenderer.on("speech:status", handler)
      return () => ipcRenderer.removeListener("speech:status", handler)
    },
    transcribe: (audio: Float32Array): Promise<string> => ipcRenderer.invoke("speech:transcribe", audio),
  },
  assistant: {
    ask: (question: string): Promise<AssistantAnswer> => ipcRenderer.invoke("assistant:ask", question),
    suggest: (query: string): Promise<AssistantSuggestion[]> => ipcRenderer.invoke("assistant:suggest", query),
  },
  privacy: {
    get: (): Promise<PrivacySettings> => ipcRenderer.invoke("privacy:get"),
    setShareRecentActivity: (enabled: boolean): Promise<PrivacySettings> =>
      ipcRenderer.invoke("privacy:setShareRecentActivity", enabled),
    setAiEnabled: (enabled: boolean): Promise<PrivacySettings> => ipcRenderer.invoke("privacy:setAiEnabled", enabled),
  },
  glossary: {
    get: (): Promise<GlossaryState> => ipcRenderer.invoke("glossary:get"),
    setBuiltinEnabled: (enabled: boolean): Promise<GlossaryState> =>
      ipcRenderer.invoke("glossary:setBuiltinEnabled", enabled),
    add: (draft: GlossaryDraft): Promise<GlossaryState> => ipcRenderer.invoke("glossary:add", draft),
    remove: (id: string): Promise<GlossaryState> => ipcRenderer.invoke("glossary:remove", id),
    import: (text: string): Promise<{ state: GlossaryState; result: GlossaryImportResult }> =>
      ipcRenderer.invoke("glossary:import", text),
  },
  /** Mémoire d'équipe : décisions consignées, propositions issues des réunions, recherche (docs/ipc/team-memory.md). */
  memory: {
    get: (): Promise<MemoryState> => ipcRenderer.invoke("memory:get"),
    save: (draft: DecisionDraft): Promise<MemoryState> => ipcRenderer.invoke("memory:save", draft),
    remove: (id: string): Promise<MemoryState> => ipcRenderer.invoke("memory:remove", id),
    dismissProposal: (id: string): Promise<MemoryState> => ipcRenderer.invoke("memory:dismissProposal", id),
    search: (query: string): Promise<MemoryHit[]> => ipcRenderer.invoke("memory:search", query),
    ask: (question: string): Promise<string> => ipcRenderer.invoke("memory:ask", question),
  },
  /** Les points à regarder aujourd'hui, choisis selon le rôle (docs/ipc/digest.md). */
  digest: {
    get: (): Promise<DailyDigest> => ipcRenderer.invoke("digest:get"),
  },
  accounts: {
    list: (): Promise<AccountSummary[]> => ipcRenderer.invoke("accounts:list"),
    /** Connexion rapide à un compte déjà enregistré ; la fenêtre se recharge sur ce compte. */
    switchTo: (id: string): Promise<void> => ipcRenderer.invoke("accounts:switch", id),
    add: (): Promise<void> => ipcRenderer.invoke("accounts:add"),
    logout: (): Promise<void> => ipcRenderer.invoke("accounts:logout"),
    remove: (id: string): Promise<void> => ipcRenderer.invoke("accounts:remove", id),
  },
  profile: {
    get: (): Promise<ProfileState> => ipcRenderer.invoke("profile:get"),
    saveEmail: (email: string): Promise<void> => ipcRenderer.invoke("profile:saveEmail", email),
    saveRole: (role: ProfileRole): Promise<void> => ipcRenderer.invoke("profile:saveRole", role),
    completeOnboarding: (): Promise<void> => ipcRenderer.invoke("profile:completeOnboarding"),
  },
  display: {
    /** Zoom de toute l'interface (comme Cmd +) : la mise en page s'adapte, frise comprise. Borné ici. */
    setZoom: (factor: number): void => {
      if (typeof factor !== "number" || !Number.isFinite(factor)) return
      webFrame.setZoomFactor(Math.min(2, Math.max(0.8, factor)))
    },
  },
  notifications: {
    /** Clic sur une notification : main indique la page à ouvrir (valeur filtrée ici). Renvoie la fonction de désabonnement. */
    onOpen: (callback: (target: NotificationTarget) => void): (() => void) => {
      const listener = (_event: unknown, target: unknown): void => {
        if (isNotificationTarget(target)) callback(target)
      }
      ipcRenderer.on("notifications:open", listener)
      return () => ipcRenderer.removeListener("notifications:open", listener)
    },
    show: (payload: NotificationPayload): Promise<NotificationResult> =>
      ipcRenderer.invoke("notifications:show", payload),
    test: (
      durationSeconds: NotificationDuration,
      options: { highContrast: boolean; reduceMotion: boolean },
    ): Promise<NotificationResult> => ipcRenderer.invoke("notifications:test", durationSeconds, options),
  },
  vocabulary: {
    list: (): Promise<PersonalShortcut[]> => ipcRenderer.invoke("vocabulary:list"),
    record: (query: string, shortcut: ShortcutDraft): Promise<PersonalShortcut> =>
      ipcRenderer.invoke("vocabulary:record", query, shortcut),
    forget: (): Promise<void> => ipcRenderer.invoke("vocabulary:forget"),
  },
}

// contextIsolation reste toujours activé dans ce projet (voir src/main/index.ts) :
// aucun repli vers window.xxx direct n'est nécessaire ni supporté. Seul `api` est
// exposé : pas de `window.electron` (@electron-toolkit/preload), qui livrerait
// ipcRenderer brut au renderer.
try {
  contextBridge.exposeInMainWorld("api", api)
} catch (error) {
  console.error(error)
}

export type Api = typeof api
