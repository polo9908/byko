/** Décision ou tâche extraite en direct de la transcription d'un point d'équipe (ticket B3). */
export type MeetingItemType = "decision" | "task"

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
