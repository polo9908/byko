/** Mémoire d'équipe : registre des décisions, propositions issues des réunions et recherche unifiée (contrat : docs/ipc/team-memory.md). */

/** Une décision consignée, avec son pourquoi : l'équivalent d'un ADR, en trois champs. */
export interface DecisionRecord {
  id: string
  /** Le sujet, souvent une question (« Pourquoi GraphQL plutôt que REST ? »). */
  title: string
  /** Ce qui a été tranché. */
  decision: string
  /** Le contexte et les raisons : ce qu'on oublie en premier. */
  why?: string
  /** Qui a porté la décision ou connaît le sujet : alimente « Qui sait quoi ». */
  people: string[]
  /** Jour de la décision, `AAAA-MM-JJ`. */
  decidedAt: string
  /** Fait partie du parcours d'arrivée (« les décisions qui expliquent le projet »). */
  key: boolean
  /** Décision de point d'équipe dont elle est issue (`MeetingDecisionRecord.id`). */
  sourceId?: string
}

export interface DecisionDraft {
  /** Présent : la décision existante est modifiée. Absent : elle est créée. */
  id?: string
  title: string
  decision: string
  why?: string
  people?: string[]
  decidedAt: string
  key?: boolean
  sourceId?: string
}

/** Décision relevée en réunion et pas encore consignée : BYKO propose d'en garder la trace. */
export interface DecisionProposal {
  /** `MeetingDecisionRecord.id`. */
  id: string
  text: string
  /** Jour de la réunion, `AAAA-MM-JJ`. */
  day: string
}

export interface MemoryState {
  /** Les plus récentes d'abord. */
  decisions: DecisionRecord[]
  proposals: DecisionProposal[]
}

export type MemoryHitKind = "decision" | "meeting" | "term" | "ticket" | "pull-request" | "design"

export interface MemoryHit {
  /** Unique dans la réponse (clé React). Pour une décision consignée : `decision:<DecisionRecord.id>`. */
  id: string
  kind: MemoryHitKind
  title: string
  detail?: string
  /** Toujours en https, construit par main à partir d'une intégration connectée. */
  url?: string
}

export const MEMORY_TITLE_MAX = 140
export const MEMORY_DECISION_MAX = 600
export const MEMORY_WHY_MAX = 1500
export const MEMORY_PERSON_MAX = 60
export const MEMORY_PEOPLE_MAX = 8
export const MEMORY_DECISIONS_MAX = 300
/** « Les 10 décisions qui expliquent le projet ». */
export const MEMORY_KEY_MAX = 10
export const MEMORY_PROPOSALS_MAX = 20
export const MEMORY_QUERY_MIN = 2
export const MEMORY_QUERY_MAX = 200
export const MEMORY_HITS_PER_KIND = 5
