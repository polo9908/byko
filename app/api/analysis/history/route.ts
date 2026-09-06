/**
 * BACK-9/BACK-10 — `GET /api/analysis/history?ticketKey=…`
 * (`docs/api-contracts.md`, §Historique des analyses — relecture).
 *
 * Route mince, comme les autres routes du projet : frontière HTTP seulement (lecture du
 * paramètre de requête, codes de statut, sérialisation JSON). Toute la logique vit dans
 * `lib/` — `lib/analysis-history.ts` (magasin partagé du coffre d'historique),
 * `lib/analysis-history-service.ts` (orchestration de la relecture) et
 * `lib/analysis-freshness.ts` (verdict de fraîcheur pur).
 *
 * Ce que cette route répond, et pourquoi : pour un `ticketKey`, le DERNIER résultat connu
 * de l'analyse (celui que BACK-7 a fait persister via BACK-10) accompagné de SON verdict de
 * fraîcheur (`staleness`) — le résultat n'est jamais renvoyé sans que sa fraîcheur soit
 * dite. Trois états de `status` : `never_analyzed` (aucun enregistrement — Jira n'est pas
 * consulté dans ce cas), `success` (résultat + fraîcheur), `error` (échec applicatif
 * rattrapé, ex. coffre d'historique illisible).
 *
 * AUCUN appel IA sur ce chemin — critère d'acceptation BACK-9 : pas de nouvelle analyse, et
 * la seule source externe est la lecture du champ `updated` du ticket, via une dépendance
 * injectée dont le défaut actuel répond « non câblé » (le connecteur de lecture Jira arrive
 * avec le câblage de la liste de tickets, FRONT-7).
 *
 * Convention de codes HTTP (`docs/api-contracts.md`, §« Convention de codes HTTP ») :
 * - requête malformée (`ticketKey` absent ou vide après normalisation) → `400`, AVANT tout
 *   accès au coffre — le `4xx` est réservé à ce cas ;
 * - échec applicatif rattrapé → `200` avec la variante `{ status: "error", message }`.
 */

import { NextResponse } from "next/server";

import { getAnalysisHistoryStore } from "@/lib/analysis-history";
import {
  defaultHistoryLookupDependencies,
  lookupTicketAnalysis,
} from "@/lib/analysis-history-service";
import type { AnalysisHistoryResponse } from "@/lib/types/analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Même normalisation que l'écriture (`lib/analysis-runner.ts`, trim de la clé) : une clé
  // saisie avec des espaces autour ne doit pas être « jamais analysée » à côté d'un
  // enregistrement écrit sans les espaces.
  const ticketKey = url.searchParams.get("ticketKey")?.trim() ?? "";
  if (ticketKey === "") {
    return NextResponse.json(
      {
        message:
          "Le paramètre de requête `ticketKey` est requis : indique la clé du ticket Jira dont tu veux relire le dernier résultat.",
      },
      { status: 400 },
    );
  }

  const store = getAnalysisHistoryStore();
  const body: AnalysisHistoryResponse = await lookupTicketAnalysis(
    store,
    ticketKey,
    defaultHistoryLookupDependencies(),
  );
  return NextResponse.json(body);
}
