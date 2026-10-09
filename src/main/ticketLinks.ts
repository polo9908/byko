import { accountDataPath } from "./accountPaths"
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import { LINKS_MAX_FIGMA_FILES, LINKS_MAX_REPOS, isIssueKey } from "../shared/links"
import type {
  DesignStatus,
  LinkedDesign,
  LinkedPullRequest,
  LinksState,
  PullRequestState,
  TrackedTicket,
  WatchedFigmaFile,
  WatchedRepo,
} from "../shared/links"

/**
 * Tickets créés en réunion et leurs liens (pull requests, maquettes, releases), plus les sources suivies (dépôts,
 * fichiers Figma). Contrat : docs/ipc/ticket-links.md. Données métier, pas des secrets : JSON en clair dans
 * `ticket-links.json` du compte, comme `meeting-decisions.json`. La synchronisation elle-même est dans `linkSync.ts`.
 */

const FILE_NAME = "ticket-links.json"
const MAX_TICKETS = 200

export type TransitionState = "proposed" | "done" | "declined"

export interface StoredTicket extends Omit<TrackedTicket, "pendingTransition"> {
  /** Actions déjà faites pour ce ticket (lien posé, fusion commentée…) : jamais refaites, même après annulation. */
  posted: string[]
  /** Commentaires inscrits « en cours » (marqueur → ISO 8601 du début) : voir `comment` dans linkSync.ts. */
  pending: Record<string, string>
  /** Liens distants annulés depuis le journal (`globalId`) : la synchronisation ne les repose pas. */
  dismissed: string[]
  transition?: TransitionState
  /** Nom du statut « terminé » proposé, tant que `transition` vaut `proposed`. */
  transitionTarget?: string
  /** ISO 8601 — depuis quand Jira répond « introuvable » pour ce ticket (voir linkSync.ts). */
  missingSince?: string
}

export interface LinkStore {
  repos: WatchedRepo[]
  figmaFiles: WatchedFigmaFile[]
  tickets: StoredTicket[]
  lastSyncAt?: string
  errors: string[]
}

/** Identifiants stables des liens distants posés sur Jira (`globalId`) : un même lien n'est jamais posé deux fois. */
export function pullRequestGlobalId(pullRequest: Pick<LinkedPullRequest, "forge" | "repo" | "number">): string {
  return `byko:pr:${pullRequest.forge}:${pullRequest.repo}#${pullRequest.number}`
}

export function designGlobalId(design: Pick<LinkedDesign, "fileKey" | "nodeId">): string {
  return `byko:design:${design.fileKey}:${design.nodeId}`
}

function emptyStore(): LinkStore {
  return { repos: [], figmaFiles: [], tickets: [], errors: [] }
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === "string" ? code : "inconnu"
}

const isString = (value: unknown): value is string => typeof value === "string"
const isHttps = (value: unknown): value is string => isString(value) && value.startsWith("https://")
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : [])

const PR_STATES: PullRequestState[] = ["open", "merged", "closed"]
const DESIGN_STATUSES: DesignStatus[] = ["in_progress", "ready_for_dev", "completed"]

function toPullRequest(value: unknown): LinkedPullRequest[] {
  const raw = (value ?? {}) as Record<string, unknown>
  if (raw.forge !== "github" || !isString(raw.repo) || typeof raw.number !== "number" || !isString(raw.title)) return []
  if (!isHttps(raw.url) || !PR_STATES.includes(raw.state as PullRequestState)) return []
  const release = (raw.release ?? {}) as Record<string, unknown>
  return [
    {
      forge: raw.forge,
      repo: raw.repo,
      number: raw.number,
      title: raw.title,
      url: raw.url,
      state: raw.state as PullRequestState,
      release: isString(release.name) && isHttps(release.url) ? { name: release.name, url: release.url } : undefined,
    },
  ]
}

function toDesign(value: unknown): LinkedDesign[] {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!isString(raw.fileKey) || !isString(raw.nodeId) || !isString(raw.name) || !isHttps(raw.url)) return []
  if (!DESIGN_STATUSES.includes(raw.status as DesignStatus)) return []
  return [{ fileKey: raw.fileKey, nodeId: raw.nodeId, name: raw.name, url: raw.url, status: raw.status as DesignStatus }]
}

function toTicket(value: unknown): StoredTicket[] {
  const raw = (value ?? {}) as Record<string, unknown>
  if (!isIssueKey(raw.issueKey) || !isHttps(raw.url) || !isString(raw.summary)) return []
  if (!isString(raw.createdAt) || Number.isNaN(Date.parse(raw.createdAt))) return []
  const transition = raw.transition
  return [
    {
      issueKey: raw.issueKey,
      url: raw.url,
      summary: raw.summary,
      createdAt: raw.createdAt,
      pullRequests: Array.isArray(raw.pullRequests) ? raw.pullRequests.flatMap(toPullRequest) : [],
      designs: Array.isArray(raw.designs) ? raw.designs.flatMap(toDesign) : [],
      posted: strings(raw.posted),
      dismissed: strings(raw.dismissed),
      pending: Object.fromEntries(
        Object.entries((raw.pending ?? {}) as Record<string, unknown>).filter(
          (entry): entry is [string, string] => isString(entry[1]) && !Number.isNaN(Date.parse(entry[1])),
        ),
      ),
      transition: transition === "proposed" || transition === "done" || transition === "declined" ? transition : undefined,
      transitionTarget: isString(raw.transitionTarget) ? raw.transitionTarget : undefined,
      missingSince: isString(raw.missingSince) && !Number.isNaN(Date.parse(raw.missingSince)) ? raw.missingSince : undefined,
    },
  ]
}

/** Recopie champ par champ : le fichier est du JSON non vérifié, rien d'inattendu ne remonte jusqu'au renderer. */
function toStore(value: unknown): LinkStore {
  const raw = (value ?? {}) as Record<string, unknown>
  return {
    repos: (Array.isArray(raw.repos) ? raw.repos : []).flatMap((entry): WatchedRepo[] => {
      const repo = (entry ?? {}) as Record<string, unknown>
      return repo.forge === "github" && isString(repo.name) ? [{ forge: repo.forge, name: repo.name }] : []
    }),
    figmaFiles: (Array.isArray(raw.figmaFiles) ? raw.figmaFiles : []).flatMap((entry): WatchedFigmaFile[] => {
      const file = (entry ?? {}) as Record<string, unknown>
      return isString(file.key) && isString(file.name) ? [{ key: file.key, name: file.name }] : []
    }),
    tickets: Array.isArray(raw.tickets) ? raw.tickets.flatMap(toTicket) : [],
    lastSyncAt: isString(raw.lastSyncAt) && !Number.isNaN(Date.parse(raw.lastSyncAt)) ? raw.lastSyncAt : undefined,
    errors: strings(raw.errors),
  }
}

async function readStore(): Promise<LinkStore> {
  const file = accountDataPath(FILE_NAME)
  let raw: string
  try {
    raw = await readFile(file, "utf-8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return emptyStore()
    throw new Error(`Lecture des liens de tickets impossible (code ${errorCode(error)}).`)
  }
  try {
    return toStore(JSON.parse(raw))
  } catch {
    // Illisible : mis de côté, jamais supprimé (même règle que meeting-decisions.json). Le message de JSON.parse,
    // qui cite le contenu, n'est pas relayé.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await rename(file, join(dirname(file), `ticket-links.corrupt-${stamp}.json`)).catch(() => undefined)
    console.warn("[ticketLinks] fichier illisible mis de côté ; reprise à vide.")
    return emptyStore()
  }
}

/** Fichier temporaire dans le même dossier puis `rename` : un arrêt en pleine écriture ne laisse jamais un JSON tronqué. */
async function writeStore(store: LinkStore): Promise<void> {
  const file = accountDataPath(FILE_NAME)
  const dir = dirname(file)
  const tmp = join(dir, `${FILE_NAME}.${randomUUID()}.tmp`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify(store))
    await rename(tmp, file)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw new Error(`Enregistrement des liens de tickets impossible (code ${errorCode(error)}).`)
  }
}

/** Lectures et écritures passent par cette file : une synchronisation et un ajout de ticket ne s'écrasent pas. */
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

export function read(): Promise<LinkStore> {
  return serialized(readStore)
}

/** Lecture, modification et écriture dans la même section sérialisée. */
export function update<T>(change: (store: LinkStore) => T): Promise<T> {
  return serialized(async () => {
    const store = await readStore()
    const result = change(store)
    await writeStore(store)
    return result
  })
}

function toState(store: LinkStore): LinksState {
  return {
    repos: store.repos,
    figmaFiles: store.figmaFiles,
    lastSyncAt: store.lastSyncAt,
    errors: store.errors,
    tickets: [...store.tickets]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(({ issueKey, url, summary, createdAt, pullRequests, designs, transition, transitionTarget }) => ({
        issueKey,
        url,
        summary,
        createdAt,
        pullRequests,
        designs,
        pendingTransition: transition === "proposed" ? (transitionTarget ?? "Terminé") : undefined,
      })),
  }
}

export async function getState(): Promise<LinksState> {
  return toState(await read())
}

/** Un ticket vient d'être créé pendant une réunion : il est suivi à partir de maintenant. */
export function track(ticket: { issueKey: string; url: string; summary: string }): Promise<void> {
  return update((store) => {
    if (!isIssueKey(ticket.issueKey) || store.tickets.some((known) => known.issueKey === ticket.issueKey)) return
    store.tickets.push({
      issueKey: ticket.issueKey,
      url: ticket.url,
      summary: ticket.summary,
      createdAt: new Date().toISOString(),
      pullRequests: [],
      designs: [],
      posted: [],
      pending: {},
      dismissed: [],
    })
    store.tickets = store.tickets
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, MAX_TICKETS)
  })
}

/** La réunion est revenue sur la tâche (ticket supprimé) : plus rien à suivre. */
export function untrack(issueKey: string): Promise<void> {
  return update((store) => {
    store.tickets = store.tickets.filter((ticket) => ticket.issueKey !== issueKey)
  })
}

export function updateSummary(issueKey: string, summary: string): Promise<void> {
  return update((store) => {
    const ticket = store.tickets.find((known) => known.issueKey === issueKey)
    if (ticket) ticket.summary = summary.replace(/\s+/g, " ").trim().slice(0, 255)
  })
}

export function addRepo(repo: WatchedRepo): Promise<LinksState> {
  return update((store) => {
    if (!store.repos.some((known) => known.forge === repo.forge && known.name.toLowerCase() === repo.name.toLowerCase())) {
      if (store.repos.length >= LINKS_MAX_REPOS) throw new Error(`${LINKS_MAX_REPOS} dépôts suivis au maximum.`)
      store.repos.push(repo)
    }
    return toState(store)
  })
}

export function removeRepo(name: string): Promise<LinksState> {
  return update((store) => {
    store.repos = store.repos.filter((repo) => repo.name !== name)
    return toState(store)
  })
}

export function addFigmaFile(file: WatchedFigmaFile): Promise<LinksState> {
  return update((store) => {
    if (!store.figmaFiles.some((known) => known.key === file.key)) {
      if (store.figmaFiles.length >= LINKS_MAX_FIGMA_FILES) {
        throw new Error(`${LINKS_MAX_FIGMA_FILES} fichiers Figma suivis au maximum.`)
      }
      store.figmaFiles.push(file)
    }
    return toState(store)
  })
}

export function removeFigmaFile(key: string): Promise<LinksState> {
  return update((store) => {
    store.figmaFiles = store.figmaFiles.filter((file) => file.key !== key)
    return toState(store)
  })
}

function change(issueKey: string, apply: (ticket: StoredTicket) => void): Promise<boolean> {
  return update((store) => {
    const ticket = store.tickets.find((known) => known.issueKey === issueKey)
    if (!ticket) return false
    apply(ticket)
    return true
  })
}

/** Inscrit qu'une action est faite pour ce ticket. Faux si le ticket n'est plus suivi. */
export function mark(issueKey: string, marker: string): Promise<boolean> {
  return change(issueKey, (ticket) => {
    if (!ticket.posted.includes(marker)) ticket.posted.push(marker)
  })
}

/** Un commentaire va partir : inscrit « en cours » avant l'envoi. Faux si le ticket n'est plus suivi. */
export function begin(issueKey: string, marker: string): Promise<boolean> {
  return change(issueKey, (ticket) => {
    ticket.pending[marker] = new Date().toISOString()
  })
}

/** Jira a accepté le commentaire. */
export function complete(issueKey: string, marker: string): Promise<boolean> {
  return change(issueKey, (ticket) => {
    delete ticket.pending[marker]
    if (!ticket.posted.includes(marker)) ticket.posted.push(marker)
  })
}

/** Jira a refusé le commentaire : il sera retenté au passage suivant. */
export function abort(issueKey: string, marker: string): Promise<boolean> {
  return change(issueKey, (ticket) => {
    delete ticket.pending[marker]
  })
}

/** Un lien distant vient d'être annulé depuis le journal : il ne sera pas reposé. */
export function dismiss(issueKey: string, globalId: string): Promise<void> {
  return update((store) => {
    const ticket = store.tickets.find((known) => known.issueKey === issueKey)
    if (!ticket) return
    if (!ticket.dismissed.includes(globalId)) ticket.dismissed.push(globalId)
    ticket.pullRequests = ticket.pullRequests.filter((pullRequest) => pullRequestGlobalId(pullRequest) !== globalId)
    ticket.designs = ticket.designs.filter((design) => designGlobalId(design) !== globalId)
  })
}
