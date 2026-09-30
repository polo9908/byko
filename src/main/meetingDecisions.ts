import { app } from "electron"
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import type { MeetingDecisionRecord, MeetingItemDraft } from "../shared/meeting"

/**
 * Décisions et tâches validées à l'envoi du compte rendu de point d'équipe
 * (contrat : docs/ipc/assistant-suggest.md). Données métier, pas des secrets :
 * JSON en clair dans `userData/meeting-decisions.json`, même précédent que
 * `journal.json`.
 *
 * Aucun message produit ici (log ou erreur) ne cite le contenu du fichier : le
 * message de `JSON.parse` embarque un extrait du texte, il n'est jamais relayé.
 */

const MAX_RECORDS = 500
const FILE_NAME = "meeting-decisions.json"

function decisionsFilePath(): string {
  return join(app.getPath("userData"), FILE_NAME)
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === "string" ? code : "inconnu"
}

/**
 * Le code `errno` est recopié sur la propriété `.code` (et pas seulement dans le
 * message) pour que l'appelant qui journalise « nom + code » (warnSourceUnavailable)
 * ne le perde pas.
 */
function fileError(error: unknown, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (typeof code === "string") err.code = code
  return err
}

function isValidRecord(value: unknown): value is MeetingDecisionRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === "string" &&
    record.id !== "" &&
    (record.type === "decision" || record.type === "task") &&
    typeof record.text === "string" &&
    record.text.trim() !== "" &&
    typeof record.createdAt === "string" &&
    !Number.isNaN(Date.parse(record.createdAt)) &&
    (record.reportId === undefined || typeof record.reportId === "string")
  )
}

/**
 * Le fichier illisible est renommé, jamais supprimé : l'utilisateur (ou le
 * support) peut encore le récupérer. `:` est interdit dans un nom de fichier
 * Windows, d'où l'horodatage réécrit.
 */
async function quarantine(file: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const targetName = `meeting-decisions.corrupt-${stamp}.json`
  const target = join(dirname(file), targetName)
  try {
    await rename(file, target)
  } catch (error) {
    throw fileError(
      error,
      `Le fichier des décisions de réunion est illisible et n'a pas pu être mis de côté (code ${errorCode(error)}).`,
    )
  }
  console.warn(
    `[meetingDecisions] fichier illisible mis de côté sous ${targetName} (dossier userData) ; reprise à vide.`,
  )
}

async function readRecords(): Promise<MeetingDecisionRecord[]> {
  const file = decisionsFilePath()
  let raw: string
  try {
    raw = await readFile(file, "utf-8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return []
    throw fileError(error, `Lecture des décisions de réunion impossible (code ${errorCode(error)}).`)
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

  const records = parsed.filter(isValidRecord)
  const ignored = parsed.length - records.length
  if (ignored > 0) {
    console.warn(`[meetingDecisions] ${ignored} enregistrement(s) mal formé(s) ignoré(s).`)
  }
  // Recopie champ par champ : un champ en trop dans le fichier ne remonte pas jusqu'au renderer.
  return records.map(({ id, reportId, type, text, createdAt }) =>
    reportId === undefined ? { id, type, text, createdAt } : { id, reportId, type, text, createdAt },
  )
}

/** Fichier temporaire dans le même dossier puis `rename` : un arrêt en pleine écriture ne laisse jamais un JSON tronqué. */
async function writeRecords(records: MeetingDecisionRecord[]): Promise<void> {
  const file = decisionsFilePath()
  const dir = dirname(file)
  const tmp = join(dir, `${FILE_NAME}.${randomUUID()}.tmp`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify(records))
    await rename(tmp, file)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw new Error(
      `Enregistrement des décisions de réunion impossible (code ${errorCode(error)}).`,
    )
  }
}

const byMostRecent = (a: MeetingDecisionRecord, b: MeetingDecisionRecord): number =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt)

/**
 * Toute lecture et écriture passe par cette file : deux envois rapprochés ne
 * perdent pas de lot, et une lecture concurrente ne peut pas mettre de côté un
 * fichier qu'une écriture vient de remplacer par un fichier sain.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/**
 * `reportId` et les drafts sont supposés déjà validés par l'appelant IPC.
 * Le dernier envoi fait foi : les enregistrements portant déjà ce `reportId`
 * sont remplacés par le lot reçu (une correction faite entre un échec partiel et
 * « Réessayer » n'est pas perdue), un lot vide les retire. Lecture, remplacement
 * et écriture dans la même section sérialisée, sinon deux appels concurrents
 * liraient le même état et laisseraient des doublons.
 */
export function saveReport(
  reportId: string,
  drafts: MeetingItemDraft[],
): Promise<MeetingDecisionRecord[]> {
  return serialized(async () => {
    const records = await readRecords()
    const others = records.filter((record) => record.reportId !== reportId)
    if (drafts.length === 0 && others.length === records.length) return []
    const createdAt = new Date().toISOString()
    const saved = drafts.map((draft): MeetingDecisionRecord => ({
      id: randomUUID(),
      reportId,
      type: draft.type,
      text: draft.text,
      createdAt,
    }))
    const kept = [...others, ...saved].sort(byMostRecent).slice(0, MAX_RECORDS)
    await writeRecords(kept)
    return saved
  })
}

/** Les plus récentes d'abord. */
export function listRecent(): Promise<MeetingDecisionRecord[]> {
  return serialized(async () => (await readRecords()).sort(byMostRecent))
}
