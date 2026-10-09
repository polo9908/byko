/** Vocabulaire des réunions : base livrée avec BYKO + liste de l'utilisateur (contrat : docs/ipc/glossary.md). */

export interface GlossaryEntry {
  id: string
  /** L'abréviation ou l'expression telle qu'on l'écrit (ex. « DoD », « refinement »). */
  term: string
  /** Ce que ça veut dire : donné à l'IA pour qu'elle comprenne et reprenne le terme correctement. */
  meaning?: string
  /** Façons dont la reconnaissance vocale l'écrit de travers (ex. « dev ops » pour « DevOps ») : remplacées par `term`. */
  aliases: string[]
  /** Équipe (squad) à laquelle le terme est propre ; absent : vocabulaire commun à tous. */
  squad?: string
}

export interface GlossaryDraft {
  term: string
  meaning?: string
  aliases?: string[]
  squad?: string
}

export interface GlossaryState {
  /** Vocabulaire de base (Agile, Scrum, IT…) utilisé ou non. */
  builtinEnabled: boolean
  builtinCount: number
  /** Vocabulaire ajouté par l'utilisateur. */
  entries: GlossaryEntry[]
}

export interface GlossaryImportResult {
  added: number
  /** Lignes ignorées (vides, déjà présentes, trop longues) ; jamais leur contenu. */
  skipped: number
}

export const GLOSSARY_TERM_MAX = 60
export const GLOSSARY_MEANING_MAX = 240
export const GLOSSARY_SQUAD_MAX = 40
export const GLOSSARY_ALIAS_MAX = 8
export const GLOSSARY_ENTRIES_MAX = 500
export const GLOSSARY_IMPORT_MAX_CHARS = 100_000
