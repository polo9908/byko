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
 *
 * FORME DE RETOUR (avenant BACK-10, `docs/api-contracts.md` §Historique des analyses) :
 * `runAnalysis` renvoie `{ events, record? }` et plus une liste nue. Les métadonnées
 * produites par le pipeline (`analyzedAt`, `sourceHash`, `updated` du snapshot analysé) ne
 * sont PAS streamées — le contrat ARCHI-4 ne les porte pas — mais elles remontent dans
 * `record`, présent UNIQUEMENT quand l'analyse a réussi en mode Jira sur un ticket portant
 * sa date de source. C'est le débouché prévu par le commentaire de `lib/analysis-pipeline.ts`
 * (BACK-7 : métadonnées « consommés par BACK-9/BACK-10 ») : la route persiste cet
 * enregistrement ; les événements du flux, eux, n'ont pas changé.
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
import type { PersistedHistoryEntry } from "@/lib/analysis-history";

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
 * Résultat d'une analyse : les événements du flux (rien d'autre ne part sur le SSE) et,
 * quand l'analyse a réussi en mode Jira, l'enregistrement d'historique que BACK-10 doit
 * persister. `record` est `undefined` en mode manuel (rien à rouvrir — décision BACK-10
 * n°2), en cas d'événement `error` terminal (résultat incomplet — un échec de l'étage
 * composants empêche aussi l'enregistrement), et quand le snapshot analysé ne porte pas sa
 * date de source (`updated` Jira) : sans elle, la fraîcheur du résultat serait indécidable
 * (décision BACK-10 n°3).
 */
export interface RunAnalysisOutcome {
  /** Événements du flux, DANS l'ordre du contrat ARCHI-4. */
  readonly events: AnalysisStreamEvent[];
  /** Enregistrement à persister, présent seulement en succès mode Jira (voir ci-dessus). */
  readonly record?: PersistedHistoryEntry;
}

/**
 * Exécute l'analyse et renvoie les événements du flux, DANS l'ordre du contrat, plus
 * l'enregistrement d'historique éventuel (voir `RunAnalysisOutcome`).
 */
export async function runAnalysis(
  request: AnalysisRequest,
  deps: AnalysisDependencies = defaultAnalysisDependencies(),
): Promise<RunAnalysisOutcome> {
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
      return { events: [toErrorEvent(outcome.message)] };
    }
    const events = toBaseEvents(outcome.result.verdict, outcome.result.clarification, outcome.result.translation);
    // Mode manuel : jamais d'enregistrement (BACK-9/BACK-10 concernent les tickets Jira).
    return { events: await withComponentsStage(events, outcome.result.needs, search) };
  }

  // Mode Jira : résolution du périmètre (BACK-5), puis récupération du ticket + corpus.
  const scope = await resolveComparisonScope({
    ticketKey: request.ticketKey,
    scopeHint: request.scopeHint,
    comparisonWindow: request.comparisonWindow,
  });
  if (scope.status === "error") {
    return { events: [toErrorEvent(scope.message)] };
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
    return {
      events: [
        toErrorEvent(
          error instanceof AnalysisNotWiredError
            ? "La récupération du ticket Jira n'est pas encore câblée (BACK-7)."
            : "Le contenu du ticket n'a pas pu être récupéré.",
        ),
      ],
    };
  }

  const corpus: TicketSnapshot[] = [];
  for (const key of scope.ticketKeys) {
    if (key === request.ticketKey) continue;
    try {
      const item = await deps.fetchTicket(key);
      if (item !== null) corpus.push(item);
    } catch {
      return {
        events: [toErrorEvent("Le contenu d'un ticket du périmètre n'a pas pu être récupéré.")],
      };
    }
  }

  const outcome = await analyzeTicket(target, corpus, deps.complete);
  if (outcome.status === "error") {
    return { events: [toErrorEvent(outcome.message)] };
  }
  const events = await withComponentsStage(
    toBaseEvents(outcome.result.verdict, outcome.result.clarification, outcome.result.translation),
    outcome.result.needs,
    search,
  );

  // Un événement `error` terminal — y compris un échec de l'étage composants (BACK-8) —
  // rend le flux incomplet : rien n'est enregistré, le « résultat » ne serait pas complet.
  if (events.some((event) => event.type === "error")) {
    return { events };
  }
  // Snapshot sans date de source (repli « ticket introuvable » du récupérateur) : aucune
  // détection de mise à jour possible plus tard, donc pas d'enregistrement (décision
  // BACK-10 n°3) — on ne persiste pas un résultat dont on ne pourra jamais vérifier la
  // fraîcheur. La clé est normalisée (trim) : les clés Jira ne contiennent pas d'espace, et
  // la relecture (BACK-9) cherchera par la même forme normalisée.
  if (target.updatedAt === null) {
    return { events };
  }
  return {
    events,
    record: {
      ticketKey: request.ticketKey.trim(),
      verdict: outcome.result.verdict,
      translation: outcome.result.translation,
      clarification: outcome.result.clarification,
      analyzedAt: outcome.result.analyzedAt,
      updatedAt: target.updatedAt,
      sourceHash: outcome.result.sourceHash,
      comparisonWindow: request.comparisonWindow,
    },
  };
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
