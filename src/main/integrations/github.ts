import { requireActiveAccount } from "../accountPaths"
import { shell } from "electron"
import { deleteSecret, getSecret, setSecret } from "../secrets"
import type { GithubConnectionStatus, LinkedRelease } from "../../shared/links"
import type { Forge, ForgePullRequest } from "./forge"

/**
 * Intégration GitHub (lecture seule) : pull requests et releases des dépôts suivis, pour la liaison automatique
 * avec les tickets créés en réunion (contrat : docs/ipc/ticket-links.md). Même principe que Jira et Figma : le
 * jeton ne revient jamais vers le renderer, seul un statut (identifiant GitHub) est renvoyé.
 */

const SECRET_KEY = "github.credentials"
const TOKEN_PAGE_URL = "https://github.com/settings/personal-access-tokens/new"
const API_ROOT = "https://api.github.com"
const WEB_ROOT = "https://github.com/"
const PULL_REQUESTS_PER_REPO = 100
/** Releases publiées après la fusion testées tour à tour (une comparaison de commits chacune). */
const MAX_RELEASE_CANDIDATES = 3
const REQUEST_TIMEOUT_MS = 20_000
/** Jetons GitHub (`ghp_…`, `github_pat_…`) : lettres, chiffres et tirets bas uniquement. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/

interface GithubCredentials {
  token: string
  login: string
}

/** `propriétaire/dépôt`, tels que GitHub les autorise ; « . » et « .. » sont exclus (jamais de remontée de chemin). */
const REPO_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/

async function readCredentials(): Promise<GithubCredentials | undefined> {
  const raw = await getSecret(SECRET_KEY)
  return raw ? (JSON.parse(raw) as GithubCredentials) : undefined
}

async function requireCredentials(): Promise<GithubCredentials> {
  const creds = await readCredentials()
  if (!creds) throw new Error("GitHub n'est pas connecté.")
  return creds
}

/**
 * Le message d'erreur de `fetch` peut citer l'en-tête d'autorisation (valeur d'en-tête invalide) : il n'est jamais
 * relayé, seul un message fixe remonte. Délai borné : une forge muette ne bloque pas la relève.
 */
async function githubFetch(token: string, path: string): Promise<Response> {
  try {
    return await fetch(`${API_ROOT}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "BYKO",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error("GitHub ne répond pas (réseau ou délai dépassé).")
  }
}

/** Chemin d'API d'un dépôt déjà validé par `assertRepoName`. */
function repoPath(repo: string): string {
  const [owner, name] = repo.split("/")
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

function webUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith(WEB_ROOT) ? value : undefined
}

/** Accepte `propriétaire/dépôt` ou l'adresse du dépôt collée telle quelle ; seul le nom est gardé. */
export function assertRepoName(value: string): string {
  const name = value
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
  if (!REPO_NAME.test(name)) {
    throw new Error("Dépôt invalide : le format attendu est « propriétaire/dépôt ».")
  }
  return name
}

/** Ouvre la page de création de jeton GitHub dans le navigateur système, jamais dans une fenêtre interne. */
export async function openTokenPage(): Promise<void> {
  await shell.openExternal(TOKEN_PAGE_URL)
}

export async function connect(rawToken: string): Promise<GithubConnectionStatus> {
  requireActiveAccount() // avant tout envoi : sans compte connecté, le jeton ne quitte pas l'appareil
  const token = rawToken.trim()
  if (!TOKEN.test(token)) {
    throw new Error("Jeton GitHub invalide : collez le jeton tel que GitHub l'affiche (ghp_… ou github_pat_…).")
  }
  const response = await githubFetch(token, "/user")
  if (!response.ok) {
    throw new Error(`Connexion GitHub refusée (${response.status}). Vérifiez le jeton.`)
  }
  const me = (await response.json()) as { login?: unknown }
  const login = typeof me.login === "string" ? me.login : ""
  await setSecret(SECRET_KEY, JSON.stringify({ token, login } satisfies GithubCredentials))
  return { connected: true, login: login || undefined }
}

export async function getStatus(): Promise<GithubConnectionStatus> {
  const creds = await readCredentials()
  return creds ? { connected: true, login: creds.login || undefined } : { connected: false }
}

export async function disconnect(): Promise<void> {
  await deleteSecret(SECRET_KEY)
}

/** Vérifie que le jeton voit bien le dépôt et renvoie son nom tel que GitHub l'écrit (casse comprise). */
export async function verifyRepo(repo: string): Promise<string> {
  const creds = await requireCredentials()
  const response = await githubFetch(creds.token, repoPath(repo))
  if (!response.ok) {
    throw new Error(
      `Dépôt GitHub « ${repo} » inaccessible (${response.status}). Vérifiez son nom et les dépôts autorisés par le jeton.`,
    )
  }
  const body = (await response.json()) as { full_name?: unknown }
  return typeof body.full_name === "string" && REPO_NAME.test(body.full_name) ? body.full_name : repo
}

interface RawPullRequest {
  number?: unknown
  title?: unknown
  body?: unknown
  html_url?: unknown
  state?: unknown
  merged_at?: unknown
  merge_commit_sha?: unknown
  head?: { ref?: unknown } | null
}

async function listPullRequests(repo: string): Promise<ForgePullRequest[]> {
  const creds = await requireCredentials()
  const response = await githubFetch(
    creds.token,
    `${repoPath(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=${PULL_REQUESTS_PER_REPO}`,
  )
  if (!response.ok) {
    throw new Error(`Lecture des pull requests de « ${repo} » impossible (${response.status}).`)
  }
  const body = (await response.json()) as unknown
  if (!Array.isArray(body)) return []
  return (body as RawPullRequest[]).flatMap((raw): ForgePullRequest[] => {
    const url = webUrl(raw.html_url)
    if (typeof raw.number !== "number" || typeof raw.title !== "string" || !url) return []
    const mergedAt = typeof raw.merged_at === "string" ? raw.merged_at : undefined
    return [
      {
        number: raw.number,
        title: raw.title,
        branch: typeof raw.head?.ref === "string" ? raw.head.ref : "",
        body: typeof raw.body === "string" ? raw.body : "",
        url,
        state: mergedAt ? "merged" : raw.state === "open" ? "open" : "closed",
        mergedAt,
        mergeCommitSha: typeof raw.merge_commit_sha === "string" ? raw.merge_commit_sha : undefined,
      },
    ]
  })
}

interface RawRelease {
  name?: unknown
  tag_name?: unknown
  html_url?: unknown
  published_at?: unknown
  draft?: unknown
}

/**
 * Une release « contient » la PR si son tag descend du commit de fusion (comparaison `commit...tag` : `ahead` ou
 * `identical`). La date seule ne suffit pas : une release publiée après la fusion peut partir d'une autre branche.
 */
async function findRelease(repo: string, pullRequest: ForgePullRequest): Promise<LinkedRelease | undefined> {
  const { mergedAt, mergeCommitSha } = pullRequest
  if (!mergedAt || !mergeCommitSha || !/^[0-9a-f]{7,64}$/i.test(mergeCommitSha)) return undefined
  const creds = await requireCredentials()
  const response = await githubFetch(creds.token, `${repoPath(repo)}/releases?per_page=30`)
  if (!response.ok) {
    throw new Error(`Lecture des releases de « ${repo} » impossible (${response.status}).`)
  }
  const body = (await response.json()) as unknown
  if (!Array.isArray(body)) return undefined
  const candidates = (body as RawRelease[])
    .flatMap((raw) => {
      const url = webUrl(raw.html_url)
      if (raw.draft === true || typeof raw.tag_name !== "string" || typeof raw.published_at !== "string" || !url) return []
      const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : raw.tag_name
      return [{ name, tag: raw.tag_name, url, publishedAt: raw.published_at }]
    })
    .filter((release) => Date.parse(release.publishedAt) >= Date.parse(mergedAt))
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
    .slice(0, MAX_RELEASE_CANDIDATES)

  for (const release of candidates) {
    const compare = await githubFetch(
      creds.token,
      `${repoPath(repo)}/compare/${mergeCommitSha}...${encodeURIComponent(release.tag)}?per_page=1`,
    )
    // Quota ou droit refusé : à signaler, pas à confondre avec « pas encore livré ».
    if (compare.status === 401 || compare.status === 403 || compare.status === 429) {
      throw new Error(`Recherche de la release dans « ${repo} » refusée par GitHub (${compare.status}).`)
    }
    if (!compare.ok) continue
    const { status } = (await compare.json()) as { status?: unknown }
    if (status === "ahead" || status === "identical") return { name: release.name.slice(0, 80), url: release.url }
  }
  return undefined
}

export const githubForge: Forge = {
  id: "github",
  label: "GitHub",
  isConnected: async () => (await getStatus()).connected,
  listPullRequests,
  findRelease,
}
