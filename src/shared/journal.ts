/**
 * Types partagés pour le Journal (ticket C1) et son annulation (ticket C2).
 * Une entrée représente une action que BCC a faite pour l'utilisateur.
 */
export type JournalEntryMode = "auto" | "with_user"

/**
 * Décrit comment défaire une entrée. Un seul type existe pour l'instant
 * (commentaire Jira) : la liste s'étend à mesure que les intégrations
 * gagnent des actions réversibles. Une entrée sans `undo` n'est pas annulable.
 */
export type JournalUndo = { type: "jira-comment"; issueKey: string; commentId: string }

export interface JournalEntry {
  id: string
  /** ISO 8601. */
  createdAt: string
  title: string
  mode: JournalEntryMode
  undo?: JournalUndo
  /** Lien externe optionnel (ex. vers le ticket Jira concerné). */
  url?: string
}
