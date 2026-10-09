/**
 * Mémos de la frise : de courtes notes « à retenir » rattachées à un rendez-vous (par son titre,
 * pour qu'un rituel récurrent garde ses notes d'un jour à l'autre). Ce ne sont pas des secrets :
 * elles vivent dans le `localStorage` du renderer, jamais côté main.
 */

export interface Memo {
  id: string
  text: string
  /** Épinglé : remonte en tête et se teinte. */
  important: boolean
}

import { scopedKey } from "./accountScope"

const STORAGE_KEY = "byko.memos.v1"
const MAX_TEXT = 280

type MemoStore = Record<string, Memo[]>

function readStore(): MemoStore {
  try {
    const raw = window.localStorage.getItem(scopedKey(STORAGE_KEY))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as MemoStore) : {}
  } catch {
    return {}
  }
}

function writeStore(store: MemoStore): void {
  try {
    window.localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(store))
  } catch {
    // Stockage indisponible (mode privé, quota) : les mémos restent valables le temps de la session.
  }
}

/** Clé stable d'un rendez-vous : le titre, sans casse ni accents. */
export function memoKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
}

export function loadMemos(title: string): Memo[] {
  const list = readStore()[memoKey(title)]
  if (!Array.isArray(list)) return []
  return list.filter((m): m is Memo => !!m && typeof m.id === "string" && typeof m.text === "string")
}

export function saveMemos(title: string, memos: Memo[]): void {
  const store = readStore()
  const key = memoKey(title)
  if (memos.length === 0) delete store[key]
  else store[key] = memos
  writeStore(store)
}

export function newMemo(text: string): Memo | null {
  const clean = text.trim().slice(0, MAX_TEXT)
  if (!clean) return null
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: clean, important: false }
}

/** Les importants d'abord, sinon l'ordre d'écriture (le plus récent en haut). */
export function sortMemos(memos: Memo[]): Memo[] {
  return [...memos].sort((a, b) => Number(b.important) - Number(a.important))
}
