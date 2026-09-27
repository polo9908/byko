import type { JiraTicketSummary } from "./jira"

/** Réponse de « Parler à BCC » (B4) : texte + tickets réels référencés, pour un rendu en cartes plutôt qu'en texte brut. */
export interface AssistantAnswer {
  text: string
  tickets: JiraTicketSummary[]
}
