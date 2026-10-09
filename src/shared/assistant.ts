import type { JiraTicketSummary } from "./jira"

/** Réponse de « Parler à BCC » (B4) : texte + tickets réels référencés, pour un rendu en cartes plutôt qu'en texte brut. */
export interface AssistantAnswer {
  text: string
  tickets: JiraTicketSummary[]
}

/** Suggestions en direct de « Parler à BCC » (contrat : docs/ipc/assistant-suggest.md). */
export type AssistantSuggestionKind = "ticket" | "journal" | "decision"

export interface AssistantSuggestion {
  /** Unique dans la réponse, stable pour une même source (clé React). Ex. "ticket:SCRUM-3", "journal:<uuid>", "decision:<uuid>". */
  id: string
  kind: AssistantSuggestionKind
  /** Texte principal affiché (résumé du ticket, titre de l'entrée journal, texte de la décision). */
  label: string
  /** Complément court optionnel : clé + statut du ticket, « Hier 14:05 », « Décision · 29/09 », etc. Construit par main. */
  detail?: string
  /** Question complète soumise à `assistant.ask` quand l'utilisateur valide la suggestion. Construite par main (gabarit déterministe, pas d'IA). */
  question: string
  /** Raccourci personnel appris localement (docs/ipc/personal-vocabulary.md) — affiché avec une marque distincte. */
  learned?: boolean
}

export const ASSISTANT_SUGGEST_MIN_CHARS = 2
export const ASSISTANT_SUGGEST_MAX_CHARS = 200
export const ASSISTANT_SUGGEST_MAX_RESULTS = 6

/** Même fenêtre pour `assistant:suggest` et `assistant:ask` : toute suggestion proposée a son contexte dans le prompt. */
export const ASSISTANT_CONTEXT_MAX_DECISIONS = 50 // les plus récentes
export const ASSISTANT_CONTEXT_MAX_JOURNAL = 100 // les plus récentes du jour calendaire d'hier
