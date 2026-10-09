import type { AssistantSuggestion, AssistantSuggestionKind } from "../shared/assistant"
import { ASSISTANT_SUGGEST_MAX_RESULTS, ASSISTANT_SUGGEST_MIN_CHARS } from "../shared/assistant"
import type { JiraTicketSummary } from "../shared/jira"
import type { JournalEntry } from "../shared/journal"
import type { MeetingDecisionRecord } from "../shared/meeting"
import type { PersonalShortcut } from "../shared/vocabulary"

/**
 * Suggestions en direct de « Parler à BCC » (contrat : docs/ipc/assistant-suggest.md).
 * Aucune dépendance à Electron ni au disque : le handler IPC lit les sources et
 * délègue ici le filtrage, ce qui garde le matching vérifiable isolément.
 */

export interface SuggestSources {
  tickets: JiraTicketSummary[]
  /** Les plus récentes d'abord. */
  decisions: MeetingDecisionRecord[]
  journal: JournalEntry[]
}

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

const SOURCE_ORDER: Record<AssistantSuggestionKind, number> = { ticket: 0, decision: 1, journal: 2 }

/**
 * 0 = pas de correspondance. Sinon : 3 si un champ commence par la requête entière,
 * 2 si un mot commence par le premier terme, 1 pour une simple sous-chaîne.
 * `fields` : textes déjà normalisés dans lesquels on cherche (ex. clé + résumé).
 */
export function score(fields: string[], normalizedQuery: string, terms: string[]): number {
  const haystack = fields.join(" ")
  if (!terms.every((term) => haystack.includes(term))) return 0
  if (fields.some((field) => field.startsWith(normalizedQuery))) return 3
  const words = haystack.split(/[^\p{L}\p{N}]+/u)
  if (words.some((word) => word.startsWith(terms[0]))) return 2
  return 1
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

interface Candidate {
  suggestion: AssistantSuggestion
  score: number
  sourceOrder: number
  index: number
}

export function matchSuggestions(query: string, sources: SuggestSources): AssistantSuggestion[] {
  const normalizedQuery = normalizeForMatch(query.trim()).replace(/\s+/g, " ")
  if (normalizedQuery.length < ASSISTANT_SUGGEST_MIN_CHARS) return []
  const terms = normalizedQuery.split(" ").filter((term) => term !== "")
  if (terms.length === 0) return []

  const candidates: Candidate[] = []
  const push = (suggestion: AssistantSuggestion, value: number): void => {
    if (value === 0) return
    candidates.push({
      suggestion,
      score: value,
      sourceOrder: SOURCE_ORDER[suggestion.kind],
      index: candidates.length,
    })
  }

  for (const ticket of sources.tickets) {
    push(
      {
        id: `ticket:${ticket.key}`,
        kind: "ticket",
        label: ticket.summary,
        detail: ticket.status ? `${ticket.key} · ${ticket.status}` : ticket.key,
        question: `Où en est le ticket ${ticket.key} « ${ticket.summary} » ?`,
      },
      score(
        [normalizeForMatch(ticket.key), normalizeForMatch(ticket.summary)],
        normalizedQuery,
        terms,
      ),
    )
  }

  for (const record of sources.decisions) {
    const date = new Date(record.createdAt)
    const isDecision = record.type === "decision"
    push(
      {
        id: `decision:${record.id}`,
        kind: "decision",
        label: record.text,
        detail: `${isDecision ? "Décision" : "Tâche"} · ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`,
        question: `Où en est la ${isDecision ? "décision" : "tâche"} du point d'équipe « ${record.text} » ?`,
      },
      score([normalizeForMatch(record.text)], normalizedQuery, terms),
    )
  }

  for (const entry of sources.journal) {
    const date = new Date(entry.createdAt)
    push(
      {
        id: `journal:${entry.id}`,
        kind: "journal",
        label: entry.title,
        detail: `Hier ${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
        question: `Qu'as-tu fait hier concernant « ${entry.title} » ?`,
      },
      score([normalizeForMatch(entry.title)], normalizedQuery, terms),
    )
  }

  // Les ids servent de clé React : un doublon côté source (même clé Jira deux fois) ne doit pas passer.
  const seen = new Set<string>()
  return candidates
    .sort((a, b) => b.score - a.score || a.sourceOrder - b.sourceOrder || a.index - b.index)
    .filter((candidate) => {
      if (seen.has(candidate.suggestion.id)) return false
      seen.add(candidate.suggestion.id)
      return true
    })
    .slice(0, ASSISTANT_SUGGEST_MAX_RESULTS)
    .map((candidate) => candidate.suggestion)
}

/**
 * Cache des tickets propre à `assistant:suggest` : une frappe = un appel IPC, on
 * ne sollicite pas Jira à chaque touche. Les appels concurrents partagent la
 * promesse en vol. Un échec vaut « source vide » pour la même durée — jamais une
 * liste inventée — et n'est signalé qu'une fois par échec.
 */
export interface TicketCache {
  get: () => Promise<JiraTicketSummary[]>
  /** À appeler quand le compte Jira change (connexion, déconnexion) : les tickets de l'ancien compte ne doivent plus être proposés. */
  invalidate: () => void
}

export function createTicketCache(
  fetchTickets: () => Promise<JiraTicketSummary[]>,
  onError: (error: unknown) => void,
  ttlMs = 30_000,
  now: () => number = Date.now,
): TicketCache {
  let cached: { value: JiraTicketSummary[]; at: number } | null = null
  let inFlight: Promise<JiraTicketSummary[]> | null = null
  // Une requête lancée avant `invalidate()` peut aboutir après : sa réponse (ancien compte) ne doit pas remplir le cache.
  let generation = 0

  return {
    get: () => {
      if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.value)
      if (inFlight) return inFlight
      const startedAt = generation
      const request = fetchTickets()
        .catch((error: unknown) => {
          onError(error)
          return []
        })
        .then((value) => {
          if (startedAt === generation) {
            cached = { value, at: now() }
            inFlight = null
          }
          return value
        })
      inFlight = request
      return request
    },
    invalidate: () => {
      generation += 1
      cached = null
      inFlight = null
    },
  }
}

/**
 * Raccourcis personnels qui correspondent à la requête en cours (contrat :
 * docs/ipc/personal-vocabulary.md). Un raccourci remonte quand la requête tapée
 * préfixe la phrase mémorisée (l'utilisateur la retape) ou l'inverse (il a tapé
 * au-delà). Les plus confirmés d'abord. `id` préfixé `personal:` pour rester
 * distinguable d'une suggestion issue d'une source, tout en gardant la cible.
 */
export function learnedSuggestions(
  query: string,
  shortcuts: PersonalShortcut[],
): AssistantSuggestion[] {
  const normalizedQuery = normalizeForMatch(query.trim()).replace(/\s+/g, " ")
  if (normalizedQuery.length < ASSISTANT_SUGGEST_MIN_CHARS) return []
  return [...shortcuts]
    .filter(
      (shortcut) =>
        shortcut.phrase.startsWith(normalizedQuery) || normalizedQuery.startsWith(shortcut.phrase),
    )
    .sort((a, b) => b.count - a.count || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((shortcut) => ({
      id: `personal:${shortcut.kind}:${shortcut.targetId}`,
      kind: shortcut.kind,
      label: shortcut.label,
      ...(shortcut.detail === undefined ? {} : { detail: shortcut.detail }),
      question: shortcut.question,
      learned: true,
    }))
}

/** Cible réelle d'une suggestion (`ticket:SCRUM-3`), pour dédupliquer un raccourci `personal:ticket:SCRUM-3`. */
function targetOf(suggestion: AssistantSuggestion): string {
  return suggestion.id.startsWith("personal:") ? suggestion.id.slice("personal:".length) : suggestion.id
}

/** Raccourcis appris en tête (ils « comprennent » l'utilisateur), dédupliqués par cible réelle avec les suggestions de source. */
export function mergeLearnedShortcuts(
  matched: AssistantSuggestion[],
  learned: AssistantSuggestion[],
): AssistantSuggestion[] {
  if (learned.length === 0) return matched
  const seen = new Set(matched.map(targetOf))
  const front: AssistantSuggestion[] = []
  for (const suggestion of learned) {
    const target = targetOf(suggestion)
    if (seen.has(target)) continue
    seen.add(target)
    front.push(suggestion)
  }
  return [...front, ...matched].slice(0, ASSISTANT_SUGGEST_MAX_RESULTS)
}
