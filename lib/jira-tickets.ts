/**
 * BACK-10 (fin, câblage FRONT-7) — lecture de la liste de tickets Jira (espace de travail).
 *
 * Interroge la recherche Jira REST v3 pour lister les tickets ouverts, dans l'ORDRE SERVEUR
 * (`ORDER BY priority DESC, updated DESC` — la sémantique de tri par priorité est celle de
 * Jira, pas une réinvention : le front ne réordonne jamais). Injecte ensuite le flag
 * `alreadyAnalyzed` depuis l'historique (BACK-10, `selectAlreadyAnalyzed`), sans jamais
 * influencer l'ordre.
 *
 * Module SERVEUR uniquement : il lit le coffre chiffré via `readJiraApiAccess`
 * (`lib/jira-scope.ts`, source unique du jeton Basic) et l'historique via
 * `getAnalysisHistoryStore()`. Même discipline que `lib/jira-scope.ts` : aucun `console.*`,
 * messages sans donnée sensible, `redirect: "manual"`, timeout par tentative.
 */

import { getAnalysisHistoryStore } from "@/lib/analysis-history";
import { readJiraApiAccess, type JiraApiAccess } from "@/lib/jira-scope";
import type { GetTicketsResponse, TicketListItem } from "@/lib/types/tickets";

const LIST_TIMEOUT_MS = 10_000;
const LIST_MAX_RESULTS = 50;

export interface ListTicketsOptions {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  maxResults?: number;
}

type ListOutcome =
  | { status: "success"; tickets: TicketListItem[] }
  | { status: "error"; message: string };

/** La requête JQL de la liste : tickets ouverts, tri par priorité puis mise à jour (serveur). */
export function buildTicketListQuery(maxResults: number): string {
  const jql = "resolution is EMPTY ORDER BY priority DESC, updated DESC";
  return `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,priority,updated&maxResults=${maxResults}`;
}

/**
 * Normalise un `issues` de la réponse de recherche (forme Jira, tolérante : un champ absent
 * devient vide/`null`, jamais une valeur inventée) et injecte le flag d'analyse. Ordre
 * d'entrée conservé.
 */
export function normalizeTicketList(
  issues: unknown,
  analyzedKeys: readonly string[],
): TicketListItem[] {
  if (!Array.isArray(issues)) return [];
  const analyzed = new Set(analyzedKeys);

  const items: TicketListItem[] = [];
  for (const issue of issues) {
    if (typeof issue !== "object" || issue === null) continue;
    const candidate = issue as {
      key?: unknown;
      fields?: { summary?: unknown; updated?: unknown; priority?: unknown };
    };
    const key = typeof candidate.key === "string" ? candidate.key : "";
    if (key === "") continue;
    const fields = candidate.fields;
    const summary = typeof fields?.summary === "string" ? fields.summary : "";
    const updatedAt = typeof fields?.updated === "string" ? fields.updated : null;
    let priorityName = "";
    let priorityIconUrl: string | undefined;
    const priority = fields?.priority;
    if (typeof priority === "object" && priority !== null) {
      const p = priority as { name?: unknown; iconUrl?: unknown };
      if (typeof p.name === "string") priorityName = p.name;
      if (typeof p.iconUrl === "string") priorityIconUrl = p.iconUrl;
    }
    items.push({
      key,
      summary,
      priorityName,
      ...(priorityIconUrl !== undefined ? { priorityIconUrl } : {}),
      updatedAt,
      alreadyAnalyzed: analyzed.has(key),
    });
  }
  return items;
}

/**
 * Appelle la recherche Jira avec l'accès fourni (injectable pour les tests). Ne lève pas.
 * L'historique est lu ici : une liste SANS flag mentirait au toggle « Déjà analysés » ; un
 * coffre d'historique illisible répond en erreur (jamais une liste sans flag).
 */
export async function fetchTicketList(
  access: JiraApiAccess,
  options: ListTicketsOptions = {},
): Promise<ListOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const maxResults = options.maxResults ?? LIST_MAX_RESULTS;
  const url = `${access.apiBase}${buildTicketListQuery(maxResults)}`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers: {
        Authorization: access.authorization,
        Accept: "application/json",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch {
    return {
      status: "error",
      message: "La liste des tickets n'a pas pu être récupérée depuis Jira. Réessayez dans un instant.",
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      message: `Jira a refusé la demande de liste de tickets (HTTP ${response.status}).`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "error", message: "La réponse de Jira est illisible." };
  }
  const issues =
    typeof body === "object" && body !== null
      ? (body as { issues?: unknown }).issues
      : undefined;

  const historyStore = getAnalysisHistoryStore();
  const history = await historyStore.read();
  if (history.status === "error") {
    return { status: "error", message: history.message };
  }
  const entries = history.status === "absent" ? [] : history.value.analyses;
  const analyzedKeys = entries.map((entry) => entry.ticketKey);

  return { status: "success", tickets: normalizeTicketList(issues, analyzedKeys) };
}

/**
 * Vue complète pour la route `GET /api/tickets` : état Jira réel puis liste + flag.
 */
export async function listWorkspaceTickets(
  options: ListTicketsOptions = {},
): Promise<GetTicketsResponse> {
  const access = await readJiraApiAccess();
  if (!access.ok) {
    // Jira non connecté (état normal du mode manuel) OU coffre illisible : la distinction
    // est faite par la route, qui pré-lit le coffre — ici on ne prétend jamais le trier.
    return { status: "error", message: access.message };
  }
  const outcome = await fetchTicketList(access.access, options);
  if (outcome.status === "error") {
    return { status: "error", message: outcome.message };
  }
  return { status: "success", jiraConnected: true, tickets: outcome.tickets };
}
