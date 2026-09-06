/**
 * BACK-10 (fin, câblage FRONT-7) — `GET /api/tickets`, la liste de gauche de l'espace de
 * travail. Voir `docs/api-contracts.md`, §« GET /api/tickets ».
 *
 * Route mince. L'état réel du coffre est pré-lu ici pour distinguer proprement :
 * - coffre illisible → `200 { status: "error", message }` (jamais rabattu sur « non connecté ») ;
 * - Jira non connecté → `200 { status: "success", jiraConnected: false, tickets: [] }`
 *   (état normal du mode manuel, FRONT-7 remplace la liste par la saisie) ;
 * - Jira connecté → la liste (ordre serveur Jira) avec le flag `alreadyAnalyzed` injecté.
 *
 * Jamais mise en cache : la liste dépend du contenu Jira et de l'historique à chaque appel.
 */

import { NextResponse } from "next/server";

import { listWorkspaceTickets } from "@/lib/jira-tickets";
import { getSettingsStore } from "@/lib/settings-store";
import { emptySettingsState, toSettingsState } from "@/lib/settings-mapper";
import type { GetTicketsResponse } from "@/lib/types/tickets";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const store = getSettingsStore();
  const result = await store.read();
  if (result.status === "error") {
    const body: GetTicketsResponse = { status: "error", message: result.message };
    return NextResponse.json(body);
  }

  const settings = result.status === "absent" ? emptySettingsState() : toSettingsState(result.value);
  if (settings.jira.status !== "connected") {
    const body: GetTicketsResponse = { status: "success", jiraConnected: false, tickets: [] };
    return NextResponse.json(body);
  }

  const body: GetTicketsResponse = await listWorkspaceTickets();
  return NextResponse.json(body);
}
