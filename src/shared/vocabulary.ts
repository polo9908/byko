import type { AssistantSuggestionKind } from "./assistant"

/**
 * Vocabulaire personnel appris localement (contrat : docs/ipc/personal-vocabulary.md).
 *
 * L'utilisateur confirme une association « ce qu'il a tapé → la suggestion qu'il a
 * choisie » ; elle est mémorisée sur sa machine (`userData/personal-vocabulary.json`)
 * et n'est jamais transmise au fournisseur IA. Elle ne fait que remonter en tête
 * des suggestions en direct et alimenter la complétion fantôme.
 */
export interface PersonalShortcut {
  /** Forme normalisée de la phrase tapée — clé d'unicité (minuscules, sans diacritiques). */
  phrase: string
  /** Dernière forme réellement tapée, telle quelle : affichage et complétion. */
  typed: string
  /** Question complète à soumettre à `assistant.ask`. */
  question: string
  kind: AssistantSuggestionKind
  /** Identifiant de la cible dans sa source (clé Jira, uuid journal/décision) — pas d'uuid de suggestion. */
  targetId: string
  /** Texte principal affiché (résumé du ticket, titre de journal, texte de décision). */
  label: string
  /** Complément court optionnel, comme `AssistantSuggestion.detail`. */
  detail?: string
  /** Nombre de confirmations de l'association (une sélection = une confirmation). */
  count: number
  /** ISO 8601 — dernière confirmation. */
  updatedAt: string
}

/** Ce que le renderer envoie : la cible d'une suggestion choisie, sans la clé canonique (dérivée de `kind` + `targetId`). */
export interface ShortcutDraft {
  kind: AssistantSuggestionKind
  targetId: string
  label: string
  question: string
  detail?: string
}

/** Bornes de `vocabulary:record`, partagées pour rejeter en amont sans écrire un fichier inutilisable. */
export const VOCABULARY_MIN_CHARS = 2
export const VOCABULARY_MAX_CHARS = 200
export const VOCABULARY_LABEL_MAX_CHARS = 300
export const VOCABULARY_QUESTION_MAX_CHARS = 500
export const VOCABULARY_DETAIL_MAX_CHARS = 200
/** Au-delà, les raccourcis les moins utilisés puis les plus anciens sont oubliés. */
export const VOCABULARY_MAX_SHORTCUTS = 200
