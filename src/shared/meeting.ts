/** Décision ou tâche extraite en direct de la transcription d'un point d'équipe (ticket B3). */
export type MeetingItemType = "decision" | "task"

/** Bornes de `meeting:sendReport`, partagées pour que l'UI ne puisse pas produire un compte rendu refusé par main. */
export const MEETING_REPORT_MAX_ITEMS = 200
export const MEETING_ITEM_MAX_CHARS = 500

export interface MeetingItemDraft {
  type: MeetingItemType
  text: string
}

/**
 * Pourquoi la réunion revient sur un item déjà noté :
 * - `cancelled` : abandonné pour de bon (« on annule », « on n'en parle plus ») — jamais reproposé ;
 * - `replaced` : remplacé ou absorbé (regroupement, correction, reformulation) — le sujet reste vivant,
 *   un autre item peut le porter.
 */
export type MeetingRemovalReason = "cancelled" | "replaced"

/** Référence un item déjà notifié à `extractItems` (par position dans la liste envoyée), pas encore identifié côté renderer. */
export interface MeetingItemRemoval {
  type: MeetingItemType
  /** Position (0-based) dans la liste `existingDecisions`/`existingTasks` envoyée à `extractItems`. */
  index: number
  reason: MeetingRemovalReason
}

/** La réunion précise, corrige ou complète un item déjà noté : son texte (et son ticket Jira) est réécrit, il n'est pas recréé. */
export interface MeetingItemUpdate {
  type: MeetingItemType
  /** Position (0-based), comme pour `MeetingItemRemoval`. */
  index: number
  text: string
}

/**
 * La réunion revient souvent sur ce qui vient d'être noté : `removals` défait un item (et son ticket Jira),
 * `updates` le réécrit en place, `additions` en ajoute. Un regroupement (« tout ça en un seul ticket »)
 * est un `update` sur l'item conservé plus des `removals` `replaced` pour les autres.
 */
export interface MeetingExtraction {
  additions: MeetingItemDraft[]
  removals: MeetingItemRemoval[]
  updates: MeetingItemUpdate[]
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
