import { BUILTIN_GLOSSARY } from "../shared/glossaryBuiltin"
import type { GlossaryEntry } from "../shared/glossary"

/**
 * Moteur du vocabulaire de réunion (fonctions pures, sans accès disque ni réseau).
 *
 * Deux usages, tous deux après la transcription (la reconnaissance vocale elle-même n'est pas modifiée) :
 *  1. `correctTranscript` : remplace les erreurs de transcription connues (« dev ops » → « DevOps »), en une seule passe.
 *  2. `glossaryPromptBlock` : liste, pour l'IA, la signification des seuls termes qui apparaissent dans la transcription.
 */

export interface LexiconEntry {
  term: string
  meaning?: string
  aliases: string[]
  /** Corriger aussi la casse du terme lui-même (« github » → « GitHub »). */
  fixCase: boolean
  custom: boolean
}

const WORD_CHAR = "\\p{L}\\p{N}"
const SPELLED_ACRONYM = /^[A-Z]{3,6}$/

/** Termes de l'utilisateur d'abord : à terme égal, ils remplacent ceux de la base. */
export function buildLexicon(custom: GlossaryEntry[], builtinEnabled: boolean): LexiconEntry[] {
  const lexicon: LexiconEntry[] = custom.map((entry) => ({
    term: entry.term,
    ...(entry.meaning ? { meaning: entry.meaning } : {}),
    aliases: entry.aliases,
    // Casse imposée seulement pour un sigle ou un nom composé (« KPIs », « GitHub ») : jamais pour un mot ordinaire.
    fixCase: entry.term.length >= 3 && /[A-Z]/.test(entry.term.slice(1)),
    custom: true,
  }))
  if (builtinEnabled) {
    const taken = new Set(lexicon.map((entry) => entry.term.toLowerCase()))
    for (const entry of BUILTIN_GLOSSARY) {
      if (taken.has(entry.term.toLowerCase())) continue
      lexicon.push({
        term: entry.term,
        meaning: entry.meaning,
        aliases: entry.aliases ?? [],
        fixCase: entry.fixCase === true,
        custom: false,
      })
    }
  }
  return lexicon
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Clé de comparaison : minuscules, espaces et tirets équivalents (« stand-up » = « stand up »). */
function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[\s-]+/g, " ").trim()
}

/** Motif d'un alias : les espaces et tirets s'équivalent, tout le reste est littéral. */
function aliasPattern(alias: string): string {
  return alias
    .trim()
    .split(/[\s-]+/)
    .map(escapeRegExp)
    .join("[\\s\\-]+")
}

/** « API » épelé : « A P I », « a-p-i », « A.P.I » (la reconnaissance vocale épelle volontiers les sigles). */
function spelledForms(term: string): string[] {
  if (!SPELLED_ACRONYM.test(term)) return []
  const letters = term.split("")
  return [letters.join(" "), letters.join(".")]
}

interface Correction {
  regex: RegExp
  canonical: Map<string, string>
}

function compileCorrection(lexicon: LexiconEntry[]): Correction | null {
  const canonical = new Map<string, string>()
  const sources: string[] = []
  const add = (source: string, term: string): void => {
    const key = normalizeKey(source)
    if (key === "" || canonical.has(key)) return
    canonical.set(key, term)
    sources.push(source)
  }
  for (const entry of lexicon) {
    for (const alias of entry.aliases) add(alias, entry.term)
    for (const form of spelledForms(entry.term)) add(form, entry.term)
    if (entry.fixCase) add(entry.term, entry.term)
  }
  if (sources.length === 0) return null
  // Les plus longs d'abord : « git hub » doit l'emporter sur « git ». Une seule passe, donc jamais de double remplacement.
  const alternation = sources
    .sort((a, b) => b.length - a.length)
    .map((source) => (source.includes(".") ? escapeRegExp(source) : aliasPattern(source)))
    .join("|")
  return { regex: new RegExp(`(?<![${WORD_CHAR}])(?:${alternation})(?![${WORD_CHAR}])`, "giu"), canonical }
}

/** Corrige les erreurs de transcription connues. Texte inchangé s'il n'y en a aucune. */
export function correctTranscript(text: string, lexicon: LexiconEntry[]): string {
  const correction = compileCorrection(lexicon)
  if (!correction) return text
  return text.replace(correction.regex, (match) => correction.canonical.get(normalizeKey(match)) ?? match)
}

/** Les sigles courts (PO, SM, AC…) ne sont reconnus qu'en majuscules : « po » ou « ac » sont des mots ou des bruits. */
function termRegex(term: string): RegExp {
  const flags = term.length <= 3 && term === term.toUpperCase() ? "u" : "iu"
  return new RegExp(`(?<![${WORD_CHAR}])${aliasPattern(term)}(?![${WORD_CHAR}])`, flags)
}

/**
 * Bloc de contexte pour l'IA : la signification des termes présents dans `text` (plafonné). Vide s'il n'y en a aucun,
 * pour ne rien envoyer d'inutile au fournisseur d'IA.
 */
export function glossaryPromptBlock(text: string, lexicon: LexiconEntry[], maxEntries = 40): string {
  const found: Array<{ entry: LexiconEntry; at: number }> = []
  for (const entry of lexicon) {
    const match = termRegex(entry.term).exec(text)
    if (match) found.push({ entry, at: match.index })
  }
  if (found.length === 0) return ""
  // Termes de l'utilisateur d'abord, puis par ordre d'apparition.
  found.sort((a, b) => Number(b.entry.custom) - Number(a.entry.custom) || a.at - b.at)
  const lines = found
    .slice(0, maxEntries)
    .map(({ entry }) => (entry.meaning ? `- ${entry.term} : ${entry.meaning}` : `- ${entry.term}`))
  return [
    "Vocabulaire de l'équipe (abréviations et expressions de cette réunion — interprète-les ainsi et reprends-les telles quelles) :",
    ...lines,
  ].join("\n")
}
