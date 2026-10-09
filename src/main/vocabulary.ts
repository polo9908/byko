import { accountDataPath } from "./accountPaths"
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import { normalizeForMatch } from "./assistantSuggest"
import type { ShortcutDraft } from "../shared/vocabulary"
import type { PersonalShortcut } from "../shared/vocabulary"
import { VOCABULARY_MAX_SHORTCUTS } from "../shared/vocabulary"
import type { AssistantSuggestionKind } from "../shared/assistant"

/**
 * Vocabulaire personnel appris localement (contrat : docs/ipc/personal-vocabulary.md).
 * Données privées de l'utilisateur, jamais transmises au fournisseur IA : JSON en
 * clair dans `userData/personal-vocabulary.json`, même précédent que `journal.json`.
 *
 * Aucun message produit ici (log ou erreur) ne cite le contenu du fichier : le
 * message de `JSON.parse` embarque un extrait du texte, il n'est jamais relayé.
 */

const FILE_NAME = "personal-vocabulary.json"
const KINDS: readonly AssistantSuggestionKind[] = ["ticket", "journal", "decision"]

function vocabularyFilePath(): string {
  return accountDataPath(FILE_NAME)
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === "string" ? code : "inconnu"
}

/** Le code `errno` est recopié sur `.code` pour que l'appelant qui journalise « nom + code » ne le perde pas. */
function fileError(error: unknown, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (typeof code === "string") err.code = code
  return err
}

function isKind(value: unknown): value is AssistantSuggestionKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value)
}

function isValidShortcut(value: unknown): value is PersonalShortcut {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.phrase === "string" &&
    record.phrase !== "" &&
    typeof record.typed === "string" &&
    record.typed.trim() !== "" &&
    typeof record.question === "string" &&
    record.question !== "" &&
    isKind(record.kind) &&
    typeof record.targetId === "string" &&
    record.targetId !== "" &&
    typeof record.label === "string" &&
    typeof record.count === "number" &&
    Number.isFinite(record.count) &&
    record.count >= 1 &&
    typeof record.updatedAt === "string" &&
    !Number.isNaN(Date.parse(record.updatedAt)) &&
    (record.detail === undefined || typeof record.detail === "string")
  )
}

/** Le fichier illisible est renommé, jamais supprimé (récupérable) ; `:` est interdit dans un nom Windows. */
async function quarantine(file: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const targetName = `personal-vocabulary.corrupt-${stamp}.json`
  try {
    await rename(file, join(dirname(file), targetName))
  } catch (error) {
    throw fileError(
      error,
      `Le vocabulaire personnel est illisible et n'a pas pu être mis de côté (code ${errorCode(error)}).`,
    )
  }
  console.warn(
    `[vocabulary] fichier illisible mis de côté sous ${targetName} (dossier userData) ; reprise à vide.`,
  )
}

async function readShortcuts(): Promise<PersonalShortcut[]> {
  const file = vocabularyFilePath()
  let raw: string
  try {
    raw = await readFile(file, "utf-8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return []
    throw fileError(error, `Lecture du vocabulaire personnel impossible (code ${errorCode(error)}).`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    await quarantine(file)
    return []
  }
  if (!Array.isArray(parsed)) {
    await quarantine(file)
    return []
  }

  const records = parsed.filter(isValidShortcut)
  const ignored = parsed.length - records.length
  if (ignored > 0) {
    console.warn(`[vocabulary] ${ignored} raccourci(s) mal formé(s) ignoré(s).`)
  }
  // Recopie champ par champ : un champ en trop dans le fichier ne remonte pas jusqu'au renderer.
  return records.map(({ phrase, typed, question, kind, targetId, label, detail, count, updatedAt }) =>
    detail === undefined
      ? { phrase, typed, question, kind, targetId, label, count, updatedAt }
      : { phrase, typed, question, kind, targetId, label, detail, count, updatedAt },
  )
}

/** Fichier temporaire dans le même dossier puis `rename` : jamais de JSON tronqué. */
async function writeShortcuts(shortcuts: PersonalShortcut[]): Promise<void> {
  const file = vocabularyFilePath()
  const tmp = join(dirname(file), `${FILE_NAME}.${randomUUID()}.tmp`)
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(tmp, JSON.stringify(shortcuts))
    await rename(tmp, file)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw fileError(error, `Enregistrement du vocabulaire personnel impossible (code ${errorCode(error)}).`)
  }
}

/** Les plus confirmés d'abord, puis les plus récents — c'est l'ordre d'affichage. */
function byWeight(a: PersonalShortcut, b: PersonalShortcut): number {
  return b.count - a.count || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
}

// Toute lecture et écriture passe par cette file : deux enregistrements rapprochés
// ne perdent pas une confirmation, et une lecture ne voit pas un fichier en cours d'écriture.
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/** Les raccourcis, les plus confirmés d'abord. */
export function list(): Promise<PersonalShortcut[]> {
  return serialized(async () => (await readShortcuts()).sort(byWeight))
}

/**
 * Confirme l'association « `query` → `draft` ». Une même phrase normalisée met à jour
 * son raccourci (dernière forme tapée, cible, `count` incrémenté) au lieu d'en créer un second.
 * `query` et `draft` sont supposés déjà validés par l'appelant IPC.
 */
export function record(query: string, draft: ShortcutDraft): Promise<PersonalShortcut> {
  return serialized(async () => {
    const phrase = normalizeForMatch(query.trim()).replace(/\s+/g, " ")
    const typed = query.trim()
    const updatedAt = new Date().toISOString()
    const shortcuts = await readShortcuts()
    const existing = shortcuts.find((shortcut) => shortcut.phrase === phrase)
    const next: PersonalShortcut = {
      phrase,
      typed,
      question: draft.question,
      kind: draft.kind,
      targetId: draft.targetId,
      label: draft.label,
      ...(draft.detail === undefined ? {} : { detail: draft.detail }),
      count: (existing?.count ?? 0) + 1,
      updatedAt,
    }
    const kept = [next, ...shortcuts.filter((shortcut) => shortcut.phrase !== phrase)]
      .sort(byWeight)
      .slice(0, VOCABULARY_MAX_SHORTCUTS)
    await writeShortcuts(kept)
    return next
  })
}

/** Oublie tous les raccourcis appris (fichier remis à `[]`). */
export function forget(): Promise<void> {
  return serialized(async () => {
    await writeShortcuts([])
  })
}
