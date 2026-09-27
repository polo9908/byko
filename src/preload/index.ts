import { contextBridge, ipcRenderer } from "electron"
import type { JiraConnectionStatus, JiraProjectSummary, JiraTicketSummary } from "../shared/jira"
import type { AIConnectionStatus, AIProviderId } from "../shared/ai"
import type { FigmaConnectionStatus } from "../shared/figma"
import type {
  GoogleCalendarConnectionStatus,
  CalendarEventSummary,
  GoogleCalendarCredentialsStatus,
  GoogleCalendarSetupPage,
} from "../shared/googleCalendar"
import type { ConnectorSetupPage, ConnectorSummary } from "../shared/connectors"
import type { JournalEntry } from "../shared/journal"
import type { AutonomyCategory, AutonomyCategoryId } from "../shared/autonomy"
import type { MeetingExtraction } from "../shared/meeting"
import type { AssistantAnswer } from "../shared/assistant"

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
    summarize: (transcript: string): Promise<string> => ipcRenderer.invoke("meeting:summarize", transcript),
    sendReport: (): Promise<void> => ipcRenderer.invoke("meeting:sendReport"),
    extractItems: (
      transcript: string,
      existingDecisions: string[],
      existingTasks: string[],
      rejectedTexts: string[],
    ): Promise<MeetingExtraction> =>
      ipcRenderer.invoke("meeting:extractItems", transcript, existingDecisions, existingTasks, rejectedTexts),
  },
  speech: {
    prepare: (): Promise<void> => ipcRenderer.invoke("speech:prepare"),
    transcribe: (audio: Float32Array): Promise<string> => ipcRenderer.invoke("speech:transcribe", audio),
  },
  assistant: {
    ask: (question: string): Promise<AssistantAnswer> => ipcRenderer.invoke("assistant:ask", question),
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
