import { requireActiveAccount } from "../accountPaths"
import { shell } from "electron"
import { deleteSecret, getSecret, setSecret } from "../secrets"
import { addEntry } from "../journal"
import type { JiraConnectionStatus, JiraProjectSummary, JiraTicketSummary } from "../../shared/jira"

/**
 * Intégration Jira (ticket E1). Toute la logique réseau et les identifiants
 * vivent ici, dans le main process : le renderer n'appelle jamais l'API
 * Atlassian directement (CORS + secret) et ne reçoit que des données déjà
 * filtrées via les handlers IPC déclarés dans `src/main/index.ts`.
 */

const SECRET_KEY = "jira.credentials"
const DEFAULT_PROJECT_SECRET_KEY = "jira.defaultProjectKey"
const TOKEN_PAGE_URL = "https://id.atlassian.com/manage-profile/security/api-tokens"

interface JiraCredentials {
  domain: string
  email: string
  apiToken: string
}

async function readCredentials(): Promise<JiraCredentials | undefined> {
  const raw = await getSecret(SECRET_KEY)
  return raw ? (JSON.parse(raw) as JiraCredentials) : undefined
}

async function requireCredentials(): Promise<JiraCredentials> {
  const creds = await readCredentials()
  if (!creds) {
    throw new Error("Jira n'est pas connecté.")
  }
  return creds
}

function authHeader(creds: JiraCredentials): string {
  return "Basic " + Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64")
}

async function jiraFetch(creds: JiraCredentials, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://${creds.domain}/rest/api/3${path}`, {
    signal: AbortSignal.timeout(20_000),
    ...init,
    headers: {
      Authorization: authHeader(creds),
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
}

/** Ouvre la page de création de jeton API Atlassian dans le navigateur système, jamais dans une fenêtre interne. */
export async function openTokenPage(): Promise<void> {
  await shell.openExternal(TOKEN_PAGE_URL)
}

export async function connect(domain: string, email: string, apiToken: string): Promise<JiraConnectionStatus> {
  requireActiveAccount() // avant tout envoi : sans compte connecté, le jeton ne quitte pas l'appareil
  const creds: JiraCredentials = { domain, email, apiToken }
  const response = await jiraFetch(creds, "/myself")
  if (!response.ok) {
    throw new Error(`Connexion Jira refusée (${response.status}). Vérifiez le domaine, l'e-mail et le jeton.`)
  }
  const me = (await response.json()) as { displayName?: string }
  await setSecret(SECRET_KEY, JSON.stringify(creds))
  return { connected: true, domain, email, displayName: me.displayName }
}

/** Prénom et nom du profil Jira (`/myself`) ; `undefined` si Jira n'est pas connecté ou ne répond pas. */
export async function fetchDisplayName(): Promise<string | undefined> {
  const creds = await readCredentials()
  if (!creds) return undefined
  const response = await jiraFetch(creds, "/myself")
  if (!response.ok) return undefined
  return ((await response.json()) as { displayName?: string }).displayName?.trim() || undefined
}

export async function getStatus(): Promise<JiraConnectionStatus> {
  const creds = await readCredentials()
  return creds ? { connected: true, domain: creds.domain, email: creds.email } : { connected: false }
}

export async function disconnect(): Promise<void> {
  await deleteSecret(SECRET_KEY)
  await deleteSecret(DEFAULT_PROJECT_SECRET_KEY)
}

/** Projet choisi à la connexion (A2) — cible des tickets créés en direct pendant un point d'équipe (B3). */
export async function setDefaultProject(projectKey: string): Promise<void> {
  await setSecret(DEFAULT_PROJECT_SECRET_KEY, projectKey)
}

export async function getDefaultProject(): Promise<string | undefined> {
  return getSecret(DEFAULT_PROJECT_SECRET_KEY)
}

export async function listProjects(): Promise<JiraProjectSummary[]> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, "/project/search?maxResults=50")
  if (!response.ok) {
    throw new Error(`Impossible de lister les projets Jira (${response.status}).`)
  }
  const body = (await response.json()) as { values: Array<{ id: string; key: string; name: string }> }
  return body.values.map((project) => ({ id: project.id, key: project.key, name: project.name }))
}

export async function getTicket(issueKey: string): Promise<JiraTicketSummary> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}?fields=summary,status`)
  if (!response.ok) {
    throw new Error(`Ticket Jira "${issueKey}" introuvable (${response.status}).`)
  }
  const issue = (await response.json()) as {
    id: string
    key: string
    fields: { summary: string; status: { name: string } }
  }
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    url: `https://${creds.domain}/browse/${issue.key}`,
  }
}

/** Type de ticket utilisé pour la création en direct (B3) : le premier type "standard" (non sous-tâche) du projet. */
async function findStandardIssueType(creds: JiraCredentials, projectKey: string): Promise<string> {
  const response = await jiraFetch(
    creds,
    `/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`,
  )
  if (!response.ok) {
    throw new Error(`Impossible de lire les types de ticket du projet "${projectKey}" (${response.status}).`)
  }
  const body = (await response.json()) as {
    projects: Array<{ issuetypes: Array<{ name: string; subtask: boolean }> }>
  }
  const issueTypes = body.projects[0]?.issuetypes ?? []
  const standard = issueTypes.find((type) => !type.subtask)
  if (!standard) {
    throw new Error(`Aucun type de ticket disponible dans le projet "${projectKey}".`)
  }
  return standard.name
}

/** Crée un vrai ticket dans le projet par défaut (voir `setDefaultProject`), pour B3 (tickets extraits en direct). */
/** Limite du champ « résumé » de Jira : au-delà, ou avec un retour à la ligne, l'API répond 400. */
const SUMMARY_MAX_CHARS = 255

/**
 * Titre (≤ 255 caractères, une seule ligne) et, si le texte est plus long, description reprenant le texte
 * complet : un regroupement de plusieurs tâches dépasse facilement la limite du résumé, et rien ne doit se perdre.
 */
function splitSummary(text: string): { summary: string; description?: unknown } {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= SUMMARY_MAX_CHARS) return { summary: clean }
  let cut = clean.slice(0, SUMMARY_MAX_CHARS - 1)
  const space = cut.lastIndexOf(" ")
  if (space > SUMMARY_MAX_CHARS / 2) cut = cut.slice(0, space)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return {
    summary: `${cut.trimEnd()}…`,
    // Format de document Atlassian, requis par l'API v3 pour la description.
    description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: clean }] }] },
  }
}

/** Détail d'erreur renvoyé par Jira (court, jamais d'identifiants : l'en-tête d'autorisation n'y figure pas). */
async function jiraErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errorMessages?: unknown; errors?: unknown }
    const messages = [
      ...(Array.isArray(body.errorMessages) ? body.errorMessages : []),
      ...(body.errors && typeof body.errors === "object" ? Object.values(body.errors) : []),
    ].filter((m): m is string => typeof m === "string")
    return messages.join(" ; ").slice(0, 300)
  } catch {
    return ""
  }
}

export async function createIssue(summary: string): Promise<JiraTicketSummary> {
  const creds = await requireCredentials()
  const projectKey = await getDefaultProject()
  if (!projectKey) {
    throw new Error("Aucun projet Jira par défaut configuré.")
  }
  const issueTypeName = await findStandardIssueType(creds, projectKey)
  const response = await jiraFetch(creds, "/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        ...splitSummary(summary),
        issuetype: { name: issueTypeName },
      },
    }),
  })
  if (!response.ok) {
    throw new Error(`Impossible de créer le ticket Jira (${response.status}) : ${await response.text()}`)
  }
  const created = (await response.json()) as { id: string; key: string }
  return {
    id: created.id,
    key: created.key,
    summary: splitSummary(summary).summary,
    status: "À faire",
    url: `https://${creds.domain}/browse/${created.key}`,
  }
}

/** Corrige le résumé d'un ticket déjà créé (B3 : édition post-enregistrement en cas d'erreur de transcription). */
export async function updateIssueSummary(issueKey: string, summary: string): Promise<void> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({ fields: splitSummary(summary) }),
  })
  if (!response.ok && response.status !== 204) {
    const detail = await jiraErrorDetail(response)
    throw new Error(`Impossible de mettre à jour le ticket "${issueKey}" (${response.status})${detail ? ` : ${detail}` : "."}`)
  }
}

/** Supprime un ticket créé par erreur (B3 : la réunion revient sur une décision et l'annule). */
export async function deleteIssue(issueKey: string): Promise<void> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}`, { method: "DELETE" })
  if (!response.ok && response.status !== 204) {
    throw new Error(`Impossible de supprimer le ticket "${issueKey}" (${response.status}).`)
  }
}

/**
 * JQL des tickets non terminés des projets connectés. Filtre sur les projets
 * plutôt que sur l'assignation : sur un site Jira perso/test, les tickets ne
 * sont souvent assignés à personne, et `assignee = currentUser()` renverrait
 * alors toujours une liste vide.
 */
async function openIssuesJql(): Promise<string | undefined> {
  const projects = await listProjects()
  if (projects.length === 0) return undefined
  const projectKeys = projects.map((project) => `"${project.key}"`).join(", ")
  return `project in (${projectKeys}) AND statusCategory != Done`
}

/** Tickets non terminés des projets connectés, les plus récemment mis à jour en premier. */
export async function searchOpenIssues(maxResults = 10): Promise<JiraTicketSummary[]> {
  const creds = await requireCredentials()
  const jql = await openIssuesJql()
  if (!jql) return []
  const response = await jiraFetch(creds, "/search/jql", {
    method: "POST",
    body: JSON.stringify({ jql: `${jql} ORDER BY updated DESC`, maxResults, fields: ["summary", "status"] }),
  })
  if (!response.ok) {
    throw new Error(`Impossible de lister les tickets Jira (${response.status}).`)
  }
  const body = (await response.json()) as {
    issues: Array<{ id: string; key: string; fields: { summary: string; status: { name: string } } }>
  }
  return body.issues.map((issue) => ({
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    url: `https://${creds.domain}/browse/${issue.key}`,
  }))
}

/** Ticket ouvert vu sous l'angle « à regarder » : ses dépendances ouvertes et sa dernière activité (digest de la vue journée). */
export interface JiraAttentionIssue {
  key: string
  summary: string
  url: string
  /** Statut de catégorie « en cours » (ni à faire, ni terminé). */
  inProgress: boolean
  /** ISO 8601 — dernière activité Jira sur le ticket. */
  updatedAt?: string
  /** Clés des tickets non terminés que celui-ci bloque. */
  blocks: string[]
  /** Clés des tickets non terminés qu'il attend. */
  blockedBy: string[]
}

interface JiraIssueLink {
  type?: { name?: string; inward?: string }
  outwardIssue?: JiraLinkedIssue
  inwardIssue?: JiraLinkedIssue
}

interface JiraLinkedIssue {
  key?: string
  fields?: { status?: { statusCategory?: { key?: string } } }
}

const ATTENTION_MAX_ISSUES = 50

/** Lien de type « Blocks » (nom standard de Jira), ou dont le libellé entrant parle de blocage sur un site renommé ou traduit. */
function isBlockingLink(link: JiraIssueLink): boolean {
  return link.type?.name?.toLowerCase() === "blocks" || /block|bloqu/i.test(link.type?.inward ?? "")
}

function openKey(issue: JiraLinkedIssue | undefined): string | undefined {
  if (!issue?.key || issue.fields?.status?.statusCategory?.key === "done") return undefined
  return issue.key
}

/**
 * Les `ATTENTION_MAX_ISSUES` tickets ouverts les plus récemment mis à jour, avec leurs liens de blocage encore ouverts.
 * Jira : sur le ticket X, `outwardIssue` Y d'un lien « Blocks » signifie « X bloque Y » ; `inwardIssue` Y, « X est bloqué par Y ».
 */
export async function searchAttentionIssues(): Promise<JiraAttentionIssue[]> {
  const creds = await requireCredentials()
  const jql = await openIssuesJql()
  if (!jql) return []
  const response = await jiraFetch(creds, "/search/jql", {
    method: "POST",
    body: JSON.stringify({
      jql: `${jql} ORDER BY updated DESC`,
      maxResults: ATTENTION_MAX_ISSUES,
      fields: ["summary", "status", "issuelinks", "updated"],
    }),
  })
  if (!response.ok) {
    throw new Error(`Impossible de lister les tickets Jira (${response.status}).`)
  }
  const body = (await response.json()) as {
    issues?: Array<{
      key: string
      fields?: {
        summary?: string
        status?: { statusCategory?: { key?: string } }
        issuelinks?: JiraIssueLink[]
        updated?: string
      }
    }>
  }
  return (body.issues ?? []).map((issue) => {
    const links = (issue.fields?.issuelinks ?? []).filter(isBlockingLink)
    const keys = (pick: (link: JiraIssueLink) => JiraLinkedIssue | undefined): string[] =>
      links.map((link) => openKey(pick(link))).filter((key): key is string => key !== undefined)
    const updated = issue.fields?.updated
    return {
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      url: `https://${creds.domain}/browse/${issue.key}`,
      inProgress: issue.fields?.status?.statusCategory?.key === "indeterminate",
      ...(updated && !Number.isNaN(Date.parse(updated)) ? { updatedAt: new Date(updated).toISOString() } : {}),
      blocks: keys((link) => link.outwardIssue),
      blockedBy: keys((link) => link.inwardIssue),
    }
  })
}

/** Nombre exact de tickets ouverts (au-delà de ce que ramènerait une page de `searchOpenIssues`). */
export async function countOpenIssues(): Promise<number> {
  const creds = await requireCredentials()
  const jql = await openIssuesJql()
  if (!jql) return 0
  const response = await jiraFetch(creds, "/search/approximate-count", {
    method: "POST",
    body: JSON.stringify({ jql }),
  })
  if (!response.ok) {
    throw new Error(`Impossible de compter les tickets Jira (${response.status}).`)
  }
  const body = (await response.json()) as { count: number }
  return body.count
}

function toAdfDocument(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  }
}

/** Poste le commentaire sans rien inscrire au journal : l'appelant s'en charge (voir `postComment`, `linkSync.ts`). */
export async function createComment(issueKey: string, body: string): Promise<{ id: string; url: string }> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: toAdfDocument(body) }),
  })
  if (!response.ok) {
    throw new Error(`Impossible de poster le commentaire sur "${issueKey}" (${response.status}).`)
  }
  const comment = (await response.json()) as { id: string }
  return { id: comment.id, url: `https://${creds.domain}/browse/${issueKey}` }
}

export async function postComment(issueKey: string, body: string): Promise<{ id: string }> {
  const comment = await createComment(issueKey, body)
  await addEntry(`Commentaire posté sur ${issueKey}`, "with_user", {
    undo: { type: "jira-comment", issueKey, commentId: comment.id },
    url: comment.url,
  })
  return { id: comment.id }
}

export async function deleteComment(issueKey: string, commentId: string): Promise<void> {
  const creds = await requireCredentials()
  const response = await jiraFetch(
    creds,
    `/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  )
  if (!response.ok && response.status !== 204) {
    throw new Error(`Impossible de supprimer le commentaire "${commentId}" sur "${issueKey}" (${response.status}).`)
  }
}

/** Adresse du ticket sur le site Jira connecté. */
export async function issueUrl(issueKey: string): Promise<string> {
  const creds = await requireCredentials()
  return `https://${creds.domain}/browse/${issueKey}`
}

/**
 * Lien distant du ticket (panneau « Liens web » de Jira) vers une pull request, une maquette ou une release.
 * `globalId` rend l'appel idempotent : Jira met à jour le lien existant au lieu d'en créer un second.
 */
export async function upsertRemoteLink(
  issueKey: string,
  link: { globalId: string; url: string; title: string },
): Promise<{ id: string }> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}/remotelink`, {
    method: "POST",
    body: JSON.stringify({ globalId: link.globalId, object: { url: link.url, title: link.title.slice(0, 255) } }),
  })
  if (!response.ok) {
    throw new Error(`Impossible de lier "${issueKey}" (${response.status}).`)
  }
  const created = (await response.json()) as { id: number | string }
  return { id: String(created.id) }
}

export async function deleteRemoteLink(issueKey: string, linkId: string): Promise<void> {
  const creds = await requireCredentials()
  const response = await jiraFetch(
    creds,
    `/issue/${encodeURIComponent(issueKey)}/remotelink/${encodeURIComponent(linkId)}`,
    { method: "DELETE" },
  )
  // 404 : le lien a déjà été retiré à la main dans Jira, l'effet voulu est obtenu.
  if (!response.ok && response.status !== 204 && response.status !== 404) {
    throw new Error(`Impossible de retirer le lien sur "${issueKey}" (${response.status}).`)
  }
}

/** `undefined` : le ticket n'existe plus (supprimé dans Jira). `done` : il est déjà dans une colonne « terminé ». */
export async function fetchIssueProgress(issueKey: string): Promise<{ done: boolean } | undefined> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}?fields=status`)
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new Error(`Lecture du ticket "${issueKey}" impossible (${response.status}).`)
  }
  const issue = (await response.json()) as { fields?: { status?: { statusCategory?: { key?: string } } } }
  return { done: issue.fields?.status?.statusCategory?.key === "done" }
}

/** Transition du flux du projet qui mène à une colonne « terminé » ; `undefined` si le flux n'en propose pas d'ici. */
export async function findDoneTransition(issueKey: string): Promise<{ id: string; statusName: string } | undefined> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}/transitions`)
  if (!response.ok) {
    throw new Error(`Lecture des statuts possibles de "${issueKey}" impossible (${response.status}).`)
  }
  const body = (await response.json()) as {
    transitions?: Array<{ id: string; to?: { name?: string; statusCategory?: { key?: string } } }>
  }
  const done = body.transitions?.find((transition) => transition.to?.statusCategory?.key === "done")
  return done ? { id: done.id, statusName: (done.to?.name ?? "Terminé").slice(0, 60) } : undefined
}

export async function transitionIssue(issueKey: string, transitionId: string): Promise<void> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transitionId } }),
  })
  if (!response.ok && response.status !== 204) {
    const detail = await jiraErrorDetail(response)
    throw new Error(`Impossible de changer le statut de "${issueKey}" (${response.status})${detail ? ` : ${detail}` : "."}`)
  }
}
