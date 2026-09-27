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
  const creds: JiraCredentials = { domain, email, apiToken }
  const response = await jiraFetch(creds, "/myself")
  if (!response.ok) {
    throw new Error(`Connexion Jira refusée (${response.status}). Vérifiez le domaine, l'e-mail et le jeton.`)
  }
  const me = (await response.json()) as { displayName?: string }
  await setSecret(SECRET_KEY, JSON.stringify(creds))
  return { connected: true, domain, email, displayName: me.displayName }
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
        summary,
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
    summary,
    status: "À faire",
    url: `https://${creds.domain}/browse/${created.key}`,
  }
}

/** Corrige le résumé d'un ticket déjà créé (B3 : édition post-enregistrement en cas d'erreur de transcription). */
export async function updateIssueSummary(issueKey: string, summary: string): Promise<void> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({ fields: { summary } }),
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(`Impossible de mettre à jour le ticket "${issueKey}" (${response.status}).`)
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

export async function postComment(issueKey: string, body: string): Promise<{ id: string }> {
  const creds = await requireCredentials()
  const response = await jiraFetch(creds, `/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: toAdfDocument(body) }),
  })
  if (!response.ok) {
    throw new Error(`Impossible de poster le commentaire sur "${issueKey}" (${response.status}).`)
  }
  const comment = (await response.json()) as { id: string }
  await addEntry(`Commentaire posté sur ${issueKey}`, "with_user", {
    undo: { type: "jira-comment", issueKey, commentId: comment.id },
    url: `https://${creds.domain}/browse/${issueKey}`,
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
