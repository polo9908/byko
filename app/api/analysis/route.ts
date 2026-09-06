/**
 * BACK-7 — `POST /api/analysis` (`docs/api-contracts.md`, §POST /api/analysis).
 *
 * Route mince : validation du corps à la frontière (`lib/analysis-request.ts`), appel de
 * l'orchestrateur (`lib/analysis-runner.ts`), sérialisation SSE des événements renvoyés.
 * Aucune logique métier ici. Streaming : un événement `AnalysisStreamEvent` par bloc
 * `data: …`, dans l'ordre imposé par le contrat (verdict → clarification? → traduction) ;
 * un échec du pipeline produit un unique événement terminal `error`.
 *
 * PERSISTANCE D'HISTORIQUE (avenant BACK-10) : quand l'analyse a réussi en mode Jira,
 * `runAnalysis` renvoie un `record` ; cette route l'enregistre via le magasin partagé
 * (`getAnalysisHistoryStore`, même mécanisme que `getSettingsStore`) AVANT de construire le
 * flux. Un échec d'enregistrement ne fait pas échouer l'analyse (le résultat est valide et
 * complet) mais n'est pas un succès silencieux : l'événement `history_error` est ajouté en
 * dernier (décision BACK-10 n°4, `docs/api-contracts.md`) — il ne remplace aucun événement
 * et ne signifie pas que le pipeline a échoué.
 *
 * Le branchement IA (génération) et la récupération du contenu Jira étant encore non
 * câblés (`defaultAnalysisDependencies`), le flux d'un appel réel se termine à ce stade par
 * l'événement `error` « branchement IA à venir » — état honnête documenté dans
 * `lib/analysis-runner.ts`, pas une panne cachée. En conséquence, aucun `record` n'existe
 * encore en production (une analyse Jira réussie suppose la récupération câblée) : la
 * persistance ci-dessous est le câblage prévu, testé au niveau des modules.
 */

import { NextResponse } from "next/server";

import { getAnalysisHistoryStore, recordAnalysis } from "@/lib/analysis-history";
import { parseAnalysisRequest } from "@/lib/analysis-request";
import { defaultAnalysisDependencies, runAnalysis } from "@/lib/analysis-runner";
import type { AnalysisHistoryErrorEvent } from "@/lib/types/analysis";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Le corps de la requête n'est pas un JSON valide." },
      { status: 400 },
    );
  }

  const parsed = parseAnalysisRequest(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  const outcome = await runAnalysis(parsed.request, defaultAnalysisDependencies());

  if (outcome.record !== undefined) {
    // `getAnalysisHistoryStore()` et non un magasin par requête : deux analyses réussies en
    // vol simultanément doivent partager la file d'écriture du coffre d'historique, sans
    // quoi la perdante répondrait `success` sans avoir été écrite (même constat que
    // `lib/settings-store.ts`, audit du 05/09/2026).
    const store = getAnalysisHistoryStore();
    const written = await recordAnalysis(store, outcome.record);
    if (written.status === "error") {
      const event: AnalysisHistoryErrorEvent = {
        type: "history_error",
        message: written.message,
      };
      outcome.events.push(event);
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of outcome.events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
