/**
 * Dernier compte rendu de point d'équipe du jour, gardé pour la carte de détail de la frise :
 * l'écran d'enregistrement ne vit qu'en mémoire, sans ça le rapport, les décisions et les tickets
 * disparaissent dès qu'on quitte l'écran. Pas de secret ici (texte de réunion, clés et liens
 * Jira) : `localStorage` du renderer, comme les mémos.
 */

import type { MeetingItemType } from "@shared/meeting"
import { scopedKey } from "./accountScope"
import { cleanPeople } from "./people"

export type MeetingReportStatus = "recording" | "done" | "sent"

export interface StoredMeetingItem {
  type: MeetingItemType
  text: string
  jiraKey?: string
  /** Toujours en https (revalidé à la lecture). */
  jiraUrl?: string
}

export interface StoredMeetingReport {
  status: MeetingReportStatus
  /** ISO 8601 — dernière mise à jour. */
  updatedAt: string
  summary: string
  items: StoredMeetingItem[]
  /** Présents d'après l'invitation : de quoi surligner leurs prénoms en relisant le compte rendu. */
  attendees?: string[]
}

const STORAGE_KEY = "byko.meeting-reports.v1"
const KEEP_DAYS = 90

type Store = Record<string, StoredMeetingReport>

export function dayKey(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(scopedKey(STORAGE_KEY))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

export function saveTodayReport(report: StoredMeetingReport): void {
  try {
    const store = readStore()
    store[dayKey(new Date())] = report
    const keep = Object.keys(store).sort().slice(-KEEP_DAYS)
    const trimmed: Store = {}
    for (const key of keep) trimmed[key] = store[key]
    window.localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(trimmed))
  } catch {
    // Stockage indisponible : le rapport reste lisible à l'écran d'enregistrement, pas dans la frise.
  }
}

function sanitize(report: StoredMeetingReport | undefined): StoredMeetingReport | null {
  if (!report || typeof report !== "object" || !Array.isArray(report.items)) return null
  const status: MeetingReportStatus = report.status === "sent" || report.status === "done" ? report.status : "recording"
  const items = report.items
    .filter((it): it is StoredMeetingItem => !!it && (it.type === "decision" || it.type === "task") && typeof it.text === "string")
    .map((it) => ({
      type: it.type,
      text: it.text,
      jiraKey: typeof it.jiraKey === "string" ? it.jiraKey : undefined,
      jiraUrl: typeof it.jiraUrl === "string" && it.jiraUrl.startsWith("https://") ? it.jiraUrl : undefined,
    }))
  const summary = typeof report.summary === "string" ? report.summary : ""
  if (items.length === 0 && !summary) return null
  const attendees = cleanPeople(report.attendees)
  return { status, updatedAt: String(report.updatedAt), summary, items, attendees: attendees.length > 0 ? attendees : undefined }
}

export function loadTodayReport(): StoredMeetingReport | null {
  return sanitize(readStore()[dayKey(new Date())])
}

export interface ArchivedReport {
  /** Jour de la réunion, `AAAA-MM-JJ`. */
  day: string
  report: StoredMeetingReport
}

/** Tous les comptes rendus gardés, du plus récent au plus ancien : l'historique consulté depuis le Journal. */
export function listReports(): ArchivedReport[] {
  const store = readStore()
  return Object.keys(store)
    .sort()
    .reverse()
    .flatMap((day) => {
      const report = sanitize(store[day])
      return report ? [{ day, report }] : []
    })
}
