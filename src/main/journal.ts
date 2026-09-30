import { app } from "electron"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import type { JournalEntry, JournalEntryMode, JournalUndo } from "../shared/journal"

/**
 * Journal des actions de BCC (ticket C1) et de leur annulation (ticket C2).
 * Contrairement aux secrets, ces entrées ne sont pas sensibles : stockage en
 * clair dans `userData/journal.json`. Ce module est la seule source de
 * vérité sur ce que BCC a "réellement" fait — les intégrations (E1/E2/E5)
 * doivent y ajouter une entrée à chaque action effectuée pour l'utilisateur,
 * plutôt que de laisser l'UI inventer un historique.
 */

function journalFilePath(): string {
  return join(app.getPath("userData"), "journal.json")
}

async function readEntries(): Promise<JournalEntry[]> {
  try {
    const raw = await readFile(journalFilePath(), "utf-8")
    return JSON.parse(raw) as JournalEntry[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function writeEntries(entries: JournalEntry[]): Promise<void> {
  const file = journalFilePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(entries))
}

export async function listToday(): Promise<JournalEntry[]> {
  const entries = await readEntries()
  const todayKey = new Date().toDateString()
  return entries
    .filter((entry) => new Date(entry.createdAt).toDateString() === todayKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Jour calendaire local précédent (pas « les dernières 24 h »), trié comme `listToday`. */
export async function listYesterday(): Promise<JournalEntry[]> {
  const entries: unknown[] = await readEntries()
  // Le fichier est du JSON non vérifié : une entrée malformée ne doit pas faire
  // échouer ask/suggest (TypeError dans le formatage ou le tri).
  const valid = entries.filter(isUsableEntry)
  const ignored = entries.length - valid.length
  if (ignored > 0) {
    console.warn(`[journal] ${ignored} entrée(s) malformée(s) ignorée(s) pour le contexte de la veille.`)
  }
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = yesterday.toDateString()
  return valid
    .filter((entry) => new Date(entry.createdAt).toDateString() === yesterdayKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function isUsableEntry(entry: unknown): entry is JournalEntry {
  if (typeof entry !== "object" || entry === null) return false
  const { title, createdAt } = entry as Record<string, unknown>
  return (
    typeof title === "string" &&
    title.trim() !== "" &&
    typeof createdAt === "string" &&
    !Number.isNaN(Date.parse(createdAt))
  )
}

export async function getEntry(id: string): Promise<JournalEntry | undefined> {
  const entries = await readEntries()
  return entries.find((entry) => entry.id === id)
}

export async function removeEntry(id: string): Promise<void> {
  const entries = await readEntries()
  await writeEntries(entries.filter((entry) => entry.id !== id))
}

export async function addEntry(
  title: string,
  mode: JournalEntryMode,
  options: { undo?: JournalUndo; url?: string } = {},
): Promise<JournalEntry> {
  const entry: JournalEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    title,
    mode,
    undo: options.undo,
    url: options.url,
  }
  const entries = await readEntries()
  entries.push(entry)
  await writeEntries(entries)
  return entry
}
