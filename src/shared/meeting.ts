/** Décision ou tâche extraite en direct de la transcription d'un point d'équipe (ticket B3). */
export type MeetingItemType = "decision" | "task"

/** Bornes de `meeting:sendReport`, partagées pour que l'UI ne puisse pas produire un compte rendu refusé par main. */
export const MEETING_REPORT_MAX_ITEMS = 200
export const MEETING_ITEM_MAX_CHARS = 500

export interface MeetingItemDraft {
  type: MeetingItemType
  text: string
}

/** Référence un item déjà notifié à `extractItems` (par position dans la liste envoyée), pas encore identifié côté renderer. */
export interface MeetingItemRemoval {
  type: MeetingItemType
  /** Position (0-based) dans la liste `existingDecisions`/`existingTasks` envoyée à `extractItems`. */
  index: number
}

/** La réunion revient parfois sur une décision déjà notée : `removals` permet de défaire l'item (et son ticket Jira) correspondant. */
export interface MeetingExtraction {
  additions: MeetingItemDraft[]
  removals: MeetingItemRemoval[]
}

/** Décision ou tâche de point d'équipe persistée (userData/meeting-decisions.json). */
export interface MeetingDecisionRecord {
  id: string
  /**
   * UUID du compte rendu (un par réunion, généré par le renderer) : rend `sendReport`
   * idempotent. Absent des enregistrements écrits avant la révision 2 du contrat.
   */
  reportId?: string
  type: MeetingItemType
  text: string
  /** ISO 8601 — moment de l'envoi du compte rendu. */
  createdAt: string
}
