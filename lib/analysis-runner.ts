/**
 * BACK-7 — orchestration de `POST /api/analysis` (verdict → clarification → traduction).
 *
 * Assemble les briques : résolution du périmètre (BACK-5), récupération du ticket et du
 * corpus (injectée), pipeline IA (BACK-7, injection `complete`), puis produit la liste
 * ORDONNÉE des événements du flux (`AnalysisStreamEvent`, ARCHI-4) que la route se
 * contente de sérialiser en SSE. Aucune logique HTTP ici.
 *
 * Les deux briques non encore vérifiées sont INJECTÉES avec des valeurs par défaut qui
 * lèvent `AnalysisNotWiredError` : ni l'appel de génération IA (aucun endpoint de
 * génération vérifié dans `lib/providers-api.ts`) ni la récupération du contenu de ticket
 * Jira ne sont câblés à ce stade. Le mode manuel, lui, n'a besoin que de `complete`.
 *
 * L'événement `components` n'est PAS émis ici : c'est l'étage BACK-8, qui viendra se
 * brancher après la traduction. L'horodatage et le hash de source produits par le pipeline
 * ne sont pas streamés (le contrat ARCHI-4 ne les porte pas) : ils sont destinés à la
 * persistance de BACK-10, qui les consommera pour BACK-9.
 */

import type {
  AnalysisClarificationEvent,
  AnalysisErrorEvent,
  AnalysisRequest,
  AnalysisStreamEvent,
  AnalysisTranslationEvent,
  AnalysisVerdictEvent,
} from "@/lib/types/analysis";
import {
  AnalysisNotWiredError,
  analyzeTicket,
  type AnalyzerCompletion,
  type TicketSnapshot,
} from "@/lib/analysis-pipeline";
import { resolveComparisonScope } from "@/lib/jira-scope";

export interface AnalysisDependencies {
  /** Complétion IA (injectée ; défaut : non câblée). */
  complete: AnalyzerCompletion;
  /** Récupération du contenu d'un ticket Jira par clé (injectée ; défaut : non câblée). */
  fetchTicket: (key: string) => Promise<TicketSnapshot | null>;
}

function notWiredCompletion(): Promise<string> {
  return Promise.reject(new AnalysisNotWiredError());
}

function notWiredTicketFetch(): Promise<TicketSnapshot | null> {
  return Promise.reject(new Error("Récupération du ticket Jira non câblée (BACK-7)."));
}

/** Dépendances de production actuelles : IA et récupération Jira non câblées (documenté). */
export function defaultAnalysisDependencies(): AnalysisDependencies {
  return { complete: notWiredCompletion, fetchTicket: notWiredTicketFetch };
}

/**
 * Exécute l'analyse et renvoie les événements du flux, DANS l'ordre du contrat.
 *
 * Ordre : `verdict` (toujours) → `clarification` (si verdict ≠ `coherent`) → `translation`
 * (toujours). En cas d'échec, un unique `error` terminal.
 */
export async function runAnalysis(
  request: AnalysisRequest,
  deps: AnalysisDependencies = defaultAnalysisDependencies(),
): Promise<AnalysisStreamEvent[]> {
  if (request.ticketSource === "manual") {
    const ticket: TicketSnapshot = {
      key: null,
      title: "Saisie manuelle",
      body: request.ticketText,
      updatedAt: null,
    };
    const outcome = await analyzeTicket(ticket, [], deps.complete);
    return outcome.status === "success"
      ? toStreamEvents(outcome.result.verdict, outcome.result.clarification, outcome.result.translation)
      : [toErrorEvent(outcome.message)];
  }

  // Mode Jira : résolution du périmètre (BACK-5), puis récupération du ticket + corpus.
  const scope = await resolveComparisonScope({
    ticketKey: request.ticketKey,
    scopeHint: request.scopeHint,
    comparisonWindow: request.comparisonWindow,
  });
  if (scope.status === "error") {
    return [toErrorEvent(scope.message)];
  }

  let target: TicketSnapshot;
  try {
    target = (await deps.fetchTicket(request.ticketKey)) ?? {
      key: request.ticketKey,
      title: "",
      body: "",
      updatedAt: null,
    };
  } catch {
    return [toErrorEvent("Le contenu du ticket n'a pas pu être récupéré (BACK-7, récupération Jira non câblée).")];
  }

  const corpus: TicketSnapshot[] = [];
  for (const key of scope.ticketKeys) {
    if (key === request.ticketKey) continue;
    try {
      const item = await deps.fetchTicket(key);
      if (item !== null) corpus.push(item);
    } catch {
      return [toErrorEvent("Le contenu d'un ticket du périmètre n'a pas pu être récupéré.")];
    }
  }

  const outcome = await analyzeTicket(target, corpus, deps.complete);
  return outcome.status === "success"
    ? toStreamEvents(outcome.result.verdict, outcome.result.clarification, outcome.result.translation)
    : [toErrorEvent(outcome.message)];
}

function toStreamEvents(
  verdict: AnalysisVerdictEvent["verdict"],
  clarification: string | null,
  translation: string,
): AnalysisStreamEvent[] {
  const events: AnalysisStreamEvent[] = [
    { type: "verdict", verdict },
    ...(clarification !== null ? [{ type: "clarification", message: clarification } as AnalysisClarificationEvent] : []),
    { type: "translation", text: translation } as AnalysisTranslationEvent,
  ];
  return events;
}

function toErrorEvent(message: string): AnalysisErrorEvent {
  return { type: "error", message };
}
