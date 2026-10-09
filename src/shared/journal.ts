/**
 * Types partagés pour le Journal (ticket C1) et son annulation (ticket C2).
 * Une entrée représente une action que BCC a faite pour l'utilisateur.
 */
export type JournalEntryMode = "auto" | "with_user"

/**
 * Décrit comment défaire une entrée : la liste s'étend à mesure que les
 * intégrations gagnent des actions réversibles. Une entrée sans `undo` n'est
 * pas annulable.
 */
export type JournalUndo =
  | { type: "jira-comment"; issueKey: string; commentId: string }
  /** Lien distant posé par la liaison automatique ; `globalId` évite qu'il soit reposé à la synchronisation suivante. */
  | { type: "jira-remote-link"; issueKey: string; linkId: string; globalId: string }

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
