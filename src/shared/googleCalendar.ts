/**
 * Types partagés pour l'intégration Google Agenda (ticket E4). Voir
 * `src/main/integrations/google-calendar.ts` pour la logique OAuth.
 */

export interface GoogleCalendarConnectionStatus {
  connected: boolean
  email?: string
}

/** Contrat : `docs/ipc/google-calendar-credentials.md`. */
export type GoogleCalendarCredentialsSource = "user" | "dev-env"

export interface GoogleCalendarCredentialsStatus {
  configured: boolean
  /** null si configured === false. Jamais de Client Secret, même masqué. */
  source: GoogleCalendarCredentialsSource | null
}

/** Pages Google Cloud Console ouvrables depuis l'assistant. Les URL vivent côté main uniquement. */
export type GoogleCalendarSetupPage = "createProject" | "enableApi" | "consentScreen" | "testUsers" | "createClient"

export const GOOGLE_CALENDAR_SETUP_PAGES: readonly GoogleCalendarSetupPage[] = [
  "createProject",
  "enableApi",
  "consentScreen",
  "testUsers",
  "createClient",
]

export interface CalendarEventSummary {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
}
