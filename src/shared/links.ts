/**
 * Liaison automatique ticket ↔ pull request ↔ maquette Figma ↔ release (contrat : docs/ipc/ticket-links.md).
 * Les tickets suivis sont ceux créés pendant un point d'équipe. Aucune valeur secrète ne transite par ce fichier.
 */

/** Forges branchées. GitLab viendra s'ajouter ici (même interface côté main, voir `integrations/forge.ts`). */
export type ForgeId = "github"

export interface GithubConnectionStatus {
  connected: boolean
  login?: string
}

export type PullRequestState = "open" | "merged" | "closed"

export interface LinkedRelease {
  name: string
  /** Toujours en https, sur le domaine de la forge (vérifié côté main). */
  url: string
}

export interface LinkedPullRequest {
  forge: ForgeId
  /** `propriétaire/dépôt`. */
  repo: string
  number: number
  title: string
  url: string
  state: PullRequestState
  /** Première release publiée qui contient le commit de fusion. */
  release?: LinkedRelease
}

/** `ready_for_dev` et `completed` sont les statuts Dev Mode de Figma ; tout le reste est « en cours ». */
export type DesignStatus = "in_progress" | "ready_for_dev" | "completed"

export interface LinkedDesign {
  fileKey: string
  nodeId: string
  name: string
  url: string
  status: DesignStatus
}

export interface TrackedTicket {
  issueKey: string
  url: string
  summary: string
  /** ISO 8601 — création du ticket pendant la réunion. */
  createdAt: string
  pullRequests: LinkedPullRequest[]
  designs: LinkedDesign[]
  /** Passage à « terminé » proposé (toutes les PR liées sont fusionnées) et en attente de validation : nom du statut cible. */
  pendingTransition?: string
}

export interface WatchedRepo {
  forge: ForgeId
  name: string
}

export interface WatchedFigmaFile {
  key: string
  name: string
}

export interface LinksState {
  tickets: TrackedTicket[]
  repos: WatchedRepo[]
  figmaFiles: WatchedFigmaFile[]
  /** ISO 8601 — dernière synchronisation terminée (même partiellement). */
  lastSyncAt?: string
  /** Sources qui n'ont pas répondu à la dernière synchronisation (messages courts, sans secret). */
  errors: string[]
}

/** Ce que la synchronisation vient de faire ou de constater : de quoi notifier et rafraîchir l'écran. */
export interface LinkEvent {
  issueKey: string
  kind: "linked" | "merged" | "design-ready" | "released" | "transition-proposed" | "transitioned"
  text: string
}

export const LINKS_MAX_REPOS = 20
export const LINKS_MAX_FIGMA_FILES = 20
export const LINKS_INPUT_MAX_CHARS = 300

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[1-9][0-9]{0,8}$/

export function isIssueKey(value: unknown): value is string {
  return typeof value === "string" && ISSUE_KEY.test(value)
}

/**
 * Vrai si `text` (nom de branche, titre de PR, nom de cadre Figma…) cite la clé du ticket. Insensible à la casse
 * (les branches sont souvent en minuscules) et borné : « PROJ-1 » ne correspond ni à « PROJ-12 » ni à « XPROJ-1 ».
 */
export function mentionsIssueKey(text: string, issueKey: string): boolean {
  const escaped = issueKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![0-9])`, "i").test(text)
}
