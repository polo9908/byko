import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import { accountDataPath } from "./accountPaths"
import { BUILTIN_GLOSSARY } from "../shared/glossaryBuiltin"
import {
  GLOSSARY_ALIAS_MAX,
  GLOSSARY_ENTRIES_MAX,
  GLOSSARY_IMPORT_MAX_CHARS,
  GLOSSARY_MEANING_MAX,
  GLOSSARY_SQUAD_MAX,
  GLOSSARY_TERM_MAX,
} from "../shared/glossary"
import type { GlossaryDraft, GlossaryEntry, GlossaryImportResult, GlossaryState } from "../shared/glossary"
import { buildLexicon, correctTranscript, glossaryPromptBlock } from "./glossaryEngine"

/**
 * Vocabulaire de réunion du compte actif (contrat : docs/ipc/glossary.md) : `glossary.json` dans le dossier du compte.
 * Une préférence de contenu, pas un secret : JSON en clair, comme `journal.json`. Écriture atomique, accès sérialisés.
 */

const FILE_NAME = "glossary.json"

interface StoredGlossary {
  builtinEnabled: boolean
  entries: GlossaryEntry[]
}

const DEFAULTS: StoredGlossary = { builtinEnabled: true, entries: [] }

function filePath(): string {
  return accountDataPath(FILE_NAME)
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 0 && text.length <= max ? text : undefined
}

/** Relit le fichier en écartant tout ce qui n'a pas la bonne forme : un fichier abîmé ne casse ni l'app ni la transcription. */
function sanitize(raw: unknown): StoredGlossary {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  const entries: GlossaryEntry[] = []
  if (Array.isArray(record.entries)) {
    for (const item of record.entries.slice(0, GLOSSARY_ENTRIES_MAX)) {
      const source = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
      const term = cleanText(source.term, GLOSSARY_TERM_MAX)
      const id = typeof source.id === "string" && source.id.length > 0 && source.id.length <= 64 ? source.id : undefined
      if (!term || !id) continue
      const meaning = cleanText(source.meaning, GLOSSARY_MEANING_MAX)
      const aliases = Array.isArray(source.aliases)
        ? source.aliases
            .map((alias) => cleanText(alias, GLOSSARY_TERM_MAX))
            .filter((alias): alias is string => alias !== undefined)
            .slice(0, GLOSSARY_ALIAS_MAX)
        : []
      const squad = cleanText(source.squad, GLOSSARY_SQUAD_MAX)
      entries.push({ id, term, ...(meaning ? { meaning } : {}), aliases, ...(squad ? { squad } : {}) })
    }
  }
  return {
    builtinEnabled: typeof record.builtinEnabled === "boolean" ? record.builtinEnabled : DEFAULTS.builtinEnabled,
    entries,
  }
}

async function read(): Promise<StoredGlossary> {
  try {
    return sanitize(JSON.parse(await readFile(filePath(), "utf-8")))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT") console.warn(`[glossary] fichier illisible (${code ?? "JSON invalide"}) ; reprise avec le vocabulaire de base.`)
    return { ...DEFAULTS, entries: [] }
  }
}

async function write(value: StoredGlossary): Promise<void> {
  const file = filePath()
  const tmp = join(dirname(file), `${FILE_NAME}.${randomUUID()}.tmp`)
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(tmp, JSON.stringify(value))
    await rename(tmp, file)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw new Error(`Enregistrement du vocabulaire impossible (code ${(error as NodeJS.ErrnoException).code ?? "inconnu"}).`)
  }
}

let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

function toState(stored: StoredGlossary): GlossaryState {
  return { builtinEnabled: stored.builtinEnabled, builtinCount: BUILTIN_GLOSSARY.length, entries: stored.entries }
}

export function getState(): Promise<GlossaryState> {
  return serialized(async () => toState(await read()))
}

export function setBuiltinEnabled(enabled: boolean): Promise<GlossaryState> {
  return serialized(async () => {
    const stored = await read()
    stored.builtinEnabled = enabled
    await write(stored)
    return toState(stored)
  })
}

/** Ajoute un terme ; s'il existe déjà (même terme, casse ignorée), il est mis à jour plutôt que dupliqué. */
export function addEntry(draft: GlossaryDraft): Promise<GlossaryState> {
  return serialized(async () => {
    const stored = await read()
    const existing = stored.entries.find((entry) => entry.term.toLowerCase() === draft.term.toLowerCase())
    if (!existing && stored.entries.length >= GLOSSARY_ENTRIES_MAX) {
      throw new Error(`Vocabulaire plein (${GLOSSARY_ENTRIES_MAX} termes maximum).`)
    }
    const entry: GlossaryEntry = {
      id: existing?.id ?? randomUUID(),
      term: draft.term,
      ...(draft.meaning ? { meaning: draft.meaning } : {}),
      aliases: draft.aliases ?? [],
      ...(draft.squad ? { squad: draft.squad } : {}),
    }
    stored.entries = existing
      ? stored.entries.map((item) => (item.id === entry.id ? entry : item))
      : [...stored.entries, entry]
    await write(stored)
    return toState(stored)
  })
}

export function removeEntry(id: string): Promise<GlossaryState> {
  return serialized(async () => {
    const stored = await read()
    stored.entries = stored.entries.filter((entry) => entry.id !== id)
    await write(stored)
    return toState(stored)
  })
}

/**
 * Import d'une liste collée : une ligne par terme. Formats acceptés (séparateur `;`, tabulation, `=` ou `:`) :
 *   `DoD = Definition of Done`   ·   `KPI ; indicateur clé de performance ; k p i | cay pi aï`
 * Les lignes vides et celles commençant par `#` sont ignorées.
 */
export function parseImport(text: string): GlossaryDraft[] {
  const drafts: GlossaryDraft[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) continue
    let parts: string[]
    if (line.includes(";") || line.includes("\t")) parts = line.split(/[;\t]/)
    else if (line.includes("=")) parts = [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]
    else if (line.includes(":")) parts = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)]
    else parts = [line]
    const term = cleanText(parts[0], GLOSSARY_TERM_MAX)
    if (!term) continue
    const meaning = cleanText(parts[1], GLOSSARY_MEANING_MAX)
    const aliases = (parts[2] ?? "")
      .split(/[|,]/)
      .map((alias) => cleanText(alias, GLOSSARY_TERM_MAX))
      .filter((alias): alias is string => alias !== undefined)
      .slice(0, GLOSSARY_ALIAS_MAX)
    drafts.push({ term, ...(meaning ? { meaning } : {}), ...(aliases.length > 0 ? { aliases } : {}) })
  }
  return drafts
}

export function importText(text: string): Promise<{ state: GlossaryState; result: GlossaryImportResult }> {
  return serialized(async () => {
    const stored = await read()
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.trim().startsWith("#")).length
    let added = 0
    for (const draft of parseImport(text)) {
      const existing = stored.entries.find((entry) => entry.term.toLowerCase() === draft.term.toLowerCase())
      if (!existing && stored.entries.length >= GLOSSARY_ENTRIES_MAX) break
      const entry: GlossaryEntry = {
        id: existing?.id ?? randomUUID(),
        term: draft.term,
        ...(draft.meaning ? { meaning: draft.meaning } : {}),
        aliases: draft.aliases ?? existing?.aliases ?? [],
        // L'import ne porte pas d'équipe : celle d'un terme déjà rangé est conservée.
        ...(existing?.squad ? { squad: existing.squad } : {}),
      }
      stored.entries = existing
        ? stored.entries.map((item) => (item.id === entry.id ? entry : item))
        : [...stored.entries, entry]
      added += 1
    }
    if (added > 0) await write(stored)
    return { state: toState(stored), result: { added, skipped: Math.max(0, lines - added) } }
  })
}

/** Tous les termes consultables (ceux de l'utilisateur d'abord, puis la base si elle est activée) : source de la recherche de la mémoire d'équipe. */
export function listTerms(): Promise<{ term: string; meaning?: string; squad?: string }[]> {
  return serialized(async () => {
    const stored = await read()
    const own = new Set(stored.entries.map((entry) => entry.term.toLowerCase()))
    const builtin = stored.builtinEnabled ? BUILTIN_GLOSSARY.filter((entry) => !own.has(entry.term.toLowerCase())) : []
    return [
      ...stored.entries.map(({ term, meaning, squad }) => ({ term, meaning, squad })),
      ...builtin.map(({ term, meaning }) => ({ term, meaning })),
    ]
  })
}

// ── Application aux réunions ───────────────────────────────────────────────────────────────────

/** Corrige la transcription ; en cas de problème avec le vocabulaire, le texte brut est renvoyé tel quel (jamais d'échec ici). */
export async function correct(text: string): Promise<string> {
  try {
    const stored = await serialized(read)
    return correctTranscript(text, buildLexicon(stored.entries, stored.builtinEnabled))
  } catch (error) {
    console.warn(`[glossary] correction ignorée (${error instanceof Error ? error.name : "inconnu"}).`)
    return text
  }
}

/** Bloc de contexte pour l'IA (vide si aucun terme du vocabulaire n'apparaît dans `text`, ou en cas de problème). */
export async function promptBlock(text: string): Promise<string> {
  try {
    const stored = await serialized(read)
    return glossaryPromptBlock(text, buildLexicon(stored.entries, stored.builtinEnabled))
  } catch {
    return ""
  }
}

// ── Validation des paramètres IPC (`unknown` → valeur sûre) ────────────────────────────────────

export function assertDraft(value: unknown): GlossaryDraft {
  if (typeof value !== "object" || value === null) throw new Error("Terme invalide : un objet est attendu.")
  const record = value as Record<string, unknown>
  const term = cleanText(record.term, GLOSSARY_TERM_MAX)
  if (!term) throw new Error(`Terme invalide : 1 à ${GLOSSARY_TERM_MAX} caractères attendus.`)
  if (record.meaning !== undefined && record.meaning !== "" && cleanText(record.meaning, GLOSSARY_MEANING_MAX) === undefined) {
    throw new Error(`Signification invalide : ${GLOSSARY_MEANING_MAX} caractères au plus.`)
  }
  if (record.aliases !== undefined && (!Array.isArray(record.aliases) || record.aliases.length > GLOSSARY_ALIAS_MAX)) {
    throw new Error(`Variantes invalides : ${GLOSSARY_ALIAS_MAX} au plus.`)
  }
  const aliases = ((record.aliases as unknown[] | undefined) ?? []).map((alias) => {
    const clean = cleanText(alias, GLOSSARY_TERM_MAX)
    if (!clean) throw new Error(`Variante invalide : 1 à ${GLOSSARY_TERM_MAX} caractères attendus.`)
    return clean
  })
  if (record.squad !== undefined && record.squad !== "" && cleanText(record.squad, GLOSSARY_SQUAD_MAX) === undefined) {
    throw new Error(`Équipe invalide : ${GLOSSARY_SQUAD_MAX} caractères au plus.`)
  }
  const meaning = cleanText(record.meaning, GLOSSARY_MEANING_MAX)
  const squad = cleanText(record.squad, GLOSSARY_SQUAD_MAX)
  return { term, ...(meaning ? { meaning } : {}), aliases, ...(squad ? { squad } : {}) }
}

export function assertEntryId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) throw new Error("Identifiant de terme invalide.")
  return value
}

export function assertImportText(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Liste vide : du texte est attendu.")
  if (value.length > GLOSSARY_IMPORT_MAX_CHARS) throw new Error(`Liste trop longue (${GLOSSARY_IMPORT_MAX_CHARS} caractères au plus).`)
  return value
}
