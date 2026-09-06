/**
 * BACK-7 — `POST /api/analysis` (`docs/api-contracts.md`, §POST /api/analysis).
 *
 * Route mince : validation du corps à la frontière (`lib/analysis-request.ts`), appel de
 * l'orchestrateur (`lib/analysis-runner.ts`), sérialisation SSE des événements renvoyés.
 * Aucune logique métier ici. Streaming : un événement `AnalysisStreamEvent` par bloc
 * `data: …`, dans l'ordre imposé par le contrat (verdict → clarification? → traduction) ;
 * un échec du pipeline produit un unique événement terminal `error`.
 *
 * Le branchement IA (génération) et la récupération du contenu Jira étant encore non
 * câblés (`defaultAnalysisDependencies`), le flux d'un appel réel se termine à ce stade par
 * l'événement `error` « branchement IA à venir » — état honnête documenté dans
 * `lib/analysis-runner.ts`, pas une panne cachée.
 */

import { NextResponse } from "next/server";

import { parseAnalysisRequest } from "@/lib/analysis-request";
import { defaultAnalysisDependencies, runAnalysis } from "@/lib/analysis-runner";

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

  const events = await runAnalysis(parsed.request, defaultAnalysisDependencies());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
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
