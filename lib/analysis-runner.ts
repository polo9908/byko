/**
 * BACK-7/BACK-8 — orchestration de `POST /api/analysis`.
 *
 * Assemble : résolution du périmètre (BACK-5), récupération du ticket et du corpus
 * (injectée), pipeline IA (BACK-7, injection `complete`), puis l'étage composants (BACK-8,
 * injection `searchComponents`), et produit la liste ORDONNÉE des événements du flux.
 *
 * Ordre : `verdict` (toujours) → `clarification` (si verdict ≠ `coherent`) → `translation`
 * (toujours) → `components` (BACK-8, porte `figmaConnected`). Un échec de l'étage composants
 * est un événement `error` TERMINAL (après la traduction), jamais un `components` falsifié.
 *
 * Les briques non encore vérifiées sont INJECTÉES avec des défauts qui lèvent
 * `AnalysisNotWiredError` : appel de génération IA et récupération du contenu Jira (aucun
 * endpoint de génération vérifié), et — quand Figma EST connecté — l'appel MCP
 * `search_design_system` (aucun serveur MCP configuré). Quand Figma n'est PAS connecté, le
 * défaut de l'étage composants répond honnêtement `figmaConnected: false` sans aucun appel.
 */

import type {
  AnalysisClarificationEvent,
  AnalysisComponentsEvent,
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
import type { ComponentSearchOutcome } from "@/lib/component-search";
import { getSettingsStore } from "@/lib/settings-store";
import { emptySettingsState, toSettingsState } from "@/lib/settings-mapper";

export interface AnalysisDependencies {
  /** Complétion IA (injectée ; défaut : non câblée). */
  complete: AnalyzerCompletion;
  /** Récupération du contenu d'un ticket Jira par clé (injectée ; défaut : non câblée). */
  fetchTicket: (key: string) => Promise<TicketSnapshot | null>;
  /** Étage composants (BACK-8) ; défaut : lit l'état Figma réel. */
  searchComponents?: (needs: readonly string[]) => Promise<ComponentSearchOutcome>;
}

function notWiredCompletion(): Promise<string> {
  return Promise.reject(new AnalysisNotWiredError());
}

function notWiredTicketFetch(): Promise<TicketSnapshot | null> {
  return Promise.reject(new AnalysisNotWiredError());
}

/**
 * Défaut de l'étage composants : lit l'état réel de la connexion Figma (coffre BACK-4).
 * Non connecté → `figmaConnected: false`, liste vide, AUCUN appel. Connecté → « non
 * câblé » : le transport MCP `search_design_system` n'existe pas encore dans cet
 * environnement (aucun serveur MCP), on ne prétend pas chercher.
 */
async function defaultComponentSearch(
  needs: readonly string[],
): Promise<ComponentSearchOutcome> {
  const store = getSettingsStore();
  const result = await store.read();
  if (result.status === "error") {
    return { status: "error", message: result.message };
  }
  const settings = result.status === "absent" ? emptySettingsState() : toSettingsState(result.value);
  if (settings.figma.status !== "connected") {
    return { status: "success", figmaConnected: false, components: [] };
  }
  if (needs.length === 0) {
    return { status: "success", figmaConnected: true, components: [] };
  }
  throw new AnalysisNotWiredError();
}

/** Dépendances de production actuelles : IA et récupération Jira non câblées (documenté). */
export function defaultAnalysisDependencies(): AnalysisDependencies {
  return {
    complete: notWiredCompletion,
    fetchTicket: notWiredTicketFetch,
    searchComponents: defaultComponentSearch,
  };
}

/**
 * Exécute l'analyse et renvoie les événements du flux, DANS l'ordre du contrat.
 */
export async function runAnalysis(
  request: AnalysisRequest,
  deps: AnalysisDependencies = defaultAnalysisDependencies(),
): Promise<AnalysisStreamEvent[]> {
  const search = deps.searchComponents ?? defaultComponentSearch;

  if (request.ticketSource === "manual") {
    const ticket: TicketSnapshot = {
      key: null,
      title: "Saisie manuelle",
      body: request.ticketText,
      updatedAt: null,
    };
    const outcome = await analyzeTicket(ticket, [], deps.complete);
    if (outcome.status === "error") {
      return [toErrorEvent(outcome.message)];
    }
    const events = toBaseEvents(outcome.result.verdict, outcome.result.clarification, outcome.result.translation);
    return withComponentsStage(events, outcome.result.needs, search);
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
  } catch (error: unknown) {
    // « Non câblé » (défaut actuel) n'est pas une panne : le message doit le dire. Un vrai
    // échec du récupérateur (une fois celui-ci câblé) restera un message générique.
    return [
      toErrorEvent(
        error instanceof AnalysisNotWiredError
          ? "La récupération du ticket Jira n'est pas encore câblée (BACK-7)."
          : "Le contenu du ticket n'a pas pu être récupéré.",
      ),
    ];
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
  if (outcome.status === "error") {
    return [toErrorEvent(outcome.message)];
  }
  const events = toBaseEvents(outcome.result.verdict, outcome.result.clarification, outcome.result.translation);
  return withComponentsStage(events, outcome.result.needs, search);
}

function toBaseEvents(
  verdict: AnalysisVerdictEvent["verdict"],
  clarification: string | null,
  translation: string,
): AnalysisStreamEvent[] {
  return [
    { type: "verdict", verdict },
    ...(clarification !== null
      ? [{ type: "clarification", message: clarification } as AnalysisClarificationEvent]
      : []),
    { type: "translation", text: translation } as AnalysisTranslationEvent,
  ];
}

async function withComponentsStage(
  events: AnalysisStreamEvent[],
  needs: readonly string[],
  search: (needs: readonly string[]) => Promise<ComponentSearchOutcome>,
): Promise<AnalysisStreamEvent[]> {
  try {
    const outcome = await search(needs);
    if (outcome.status === "success") {
      events.push({
        type: "components",
        figmaConnected: outcome.figmaConnected,
        components: outcome.components,
      } as AnalysisComponentsEvent);
    } else {
      events.push(toErrorEvent(outcome.message));
    }
  } catch (error: unknown) {
    events.push(
      toErrorEvent(
        error instanceof AnalysisNotWiredError
          ? "La recherche de composants n'est pas encore câblée (BACK-8)."
          : "La recherche de composants a échoué.",
      ),
    );
  }
  return events;
}

function toErrorEvent(message: string): AnalysisErrorEvent {
  return { type: "error", message };
}
