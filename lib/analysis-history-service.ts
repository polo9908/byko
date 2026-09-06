/**
 * BACK-9/BACK-10 — Relecture du dernier résultat connu d'un ticket (`GET
 * /api/analysis/history`), et détection de mise à jour.
 *
 * Orchestration, séparée de la route pour être testable sans HTTP : lecture du magasin
 * d'historique partagé (injecté), recherche de l'entrée du ticket, puis — seulement si une
 * entrée existe — récupération de l'état courant du ticket Jira par une dépendance
 * INJECTÉE (`fetchTicket`, même forme que dans `lib/analysis-runner.ts`) et calcul du
 * verdict de fraîcheur (fonction pure de `lib/analysis-freshness.ts`).
 *
 * AUCUN appel IA sur ce chemin — critère d'acceptation BACK-9 : la seule source externe est
 * la lecture du champ `updated` du ticket, et la garantie est structurelle (ce module ne
 * reçoit aucune dépendance de complétion ; voir aussi les tests).
 *
 * « Non câblé » ≠ panne : le défaut de la dépendance Jira lève `AnalysisNotWiredError`
 * (même avenant que BACK-7), et la `reason` du verdict de fraîcheur le dit — la récupération
 * Jira sera branchée avec le connecteur de lecture (FRONT-7), pas avant.
 *
 * Règle des trois états, appliquée à la réponse : `never_analyzed` (aucune entrée — l'API ne
 * consulte PAS Jira dans ce cas, rien à vérifier), `success` (le résultat connu est TOUJOURS
 * accompagné de son verdict de fraîcheur explicite), `error` (échec applicatif rattrapé,
 * ex. coffre d'historique illisible). Jamais de « résultat renvoyé sans fraîcheur dite » :
 * présenter un résultat comme fiable sans avoir pu vérifier l'état courant du ticket serait
 * exactement le « se fier à un résultat obsolète » que l'US de BACK-9 veut empêcher.
 */

import {
  AnalysisNotWiredError,
  type TicketSnapshot,
} from "@/lib/analysis-pipeline";
import { assessFreshness } from "@/lib/analysis-freshness";
import type {
  PersistedHistoryDocument,
  PersistedHistoryEntry,
} from "@/lib/analysis-history";
import type {
  AnalysisHistoryRecord,
  AnalysisHistoryResponse,
} from "@/lib/types/analysis";
import type { EncryptedStore } from "@/lib/token-storage";

type HistoryStore = EncryptedStore<PersistedHistoryDocument>;

/** Récupération de l'état courant d'un ticket Jira par clé — injectée, jamais importée. */
export interface HistoryLookupDependencies {
  fetchTicket: (key: string) => Promise<TicketSnapshot | null>;
}

function notWiredTicketFetch(): Promise<TicketSnapshot | null> {
  return Promise.reject(new AnalysisNotWiredError());
}

/** Dépendances de production actuelles : récupération Jira non câblée (documenté). */
export function defaultHistoryLookupDependencies(): HistoryLookupDependencies {
  return { fetchTicket: notWiredTicketFetch };
}

const REASON_FETCH_NOT_WIRED =
  "La récupération du ticket Jira n'est pas encore câblée (le connecteur de lecture arrive avec le câblage de la liste de tickets) : la fraîcheur du résultat ne peut pas être vérifiée pour l'instant.";
const REASON_FETCH_FAILED =
  "L'état courant du ticket n'a pas pu être récupéré depuis Jira : la fraîcheur du résultat ne peut pas être vérifiée. Réessaye dans un instant.";

/**
 * Construit la forme publique de l'enregistrement, CHAMP PAR CHAMP (discipline du
 * §Jetons de `docs/api-contracts.md`) : `sourceHash` et `ticketKey` sont des métadonnées
 * internes sans consommateur d'affichage — on n'expose que les sections rejouées et les
 * métadonnées de fraîcheur.
 */
function toPublicRecord(entry: PersistedHistoryEntry): AnalysisHistoryRecord {
  return {
    verdict: entry.verdict,
    translation: entry.translation,
    clarification: entry.clarification,
    analyzedAt: entry.analyzedAt,
    updatedAt: entry.updatedAt,
    comparisonWindow: entry.comparisonWindow,
  };
}

/**
 * Répond à `GET /api/analysis/history?ticketKey=…`. Ne lève jamais : chaque échec est une
 * variante de la réponse (coffre illisible → `error` ; état courant indisponible →
 * `staleness: unknown` avec sa raison).
 */
export async function lookupTicketAnalysis(
  store: HistoryStore,
  ticketKey: string,
  deps: HistoryLookupDependencies = defaultHistoryLookupDependencies(),
): Promise<AnalysisHistoryResponse> {
  const read = await store.read();

  if (read.status === "error") {
    // Coffre illisible : le message du magasin est déjà français et sans contenu du document
    // (il vient du décodage de `lib/analysis-history.ts`) — on le remonte tel quel, jamais
    // rabattu sur « jamais analysé », qui orienterait l'utilisateur vers une analyse alors
    // que le problème est le disque.
    return { status: "error", message: read.message };
  }

  const analyses = read.status === "loaded" ? read.value.analyses : [];
  const entry = analyses.find((item) => item.ticketKey === ticketKey);
  if (entry === undefined) {
    // Aucune entrée : réponse « jamais analysé », SANS consulter Jira — il n'y a rien à
    // vérifier, et un appel réseau pour rien ralentirait l'ouverture d'un ticket neuf.
    return { status: "never_analyzed" };
  }

  let current: TicketSnapshot | null;
  try {
    current = await deps.fetchTicket(ticketKey);
  } catch (error: unknown) {
    // « Non câblé » (défaut actuel) n'est pas une panne : la raison le dit (message
    // explicite, comme dans le pipeline). Un vrai échec du récupérateur (une fois celui-ci
    // câblé) reste un message générique.
    const reason =
      error instanceof AnalysisNotWiredError ? REASON_FETCH_NOT_WIRED : REASON_FETCH_FAILED;
    return { status: "success", record: toPublicRecord(entry), staleness: { status: "unknown", reason } };
  }

  // `updated` absent (snapshot nul — ticket introuvable — ou date non fournie par le
  // connecteur) : la fonction pure répond `unknown`, jamais « à jour » par défaut.
  const staleness = assessFreshness(entry.updatedAt, current?.updatedAt ?? null);
  return { status: "success", record: toPublicRecord(entry), staleness };
}
