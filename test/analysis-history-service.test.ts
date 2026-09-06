/**
 * BACK-9/BACK-10 — `lib/analysis-history-service.ts` : relecture du dernier résultat connu
 * et verdict de fraîcheur, hors HTTP (le magasin est injecté, sur répertoire temporaire).
 *
 * Couvre les trois états de la réponse (`never_analyzed` / `success` / `error`), la
 * distinction « jamais analysé » ≠ « résultat connu », le `staleSince` après modification,
 * la distinction « non câblé » ≠ panne, et l'absence d'appel réseau/IA : la seule source
 * externe de ce chemin est la dépendance INJECTÉE `fetchTicket` — le module ne reçoit
 * aucune dépendance de complétion (garantie structurelle), et la garde `withStubbedFetch`
 * prouve qu'aucun `fetch` global ne part d'ici.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AnalysisNotWiredError, type TicketSnapshot } from "@/lib/analysis-pipeline";
import {
  HISTORY_SCHEMA_VERSION,
  createAnalysisHistoryStore,
  defaultHistoryVaultLocation,
  type PersistedHistoryDocument,
  type PersistedHistoryEntry,
} from "@/lib/analysis-history";
import {
  defaultHistoryLookupDependencies,
  lookupTicketAnalysis,
} from "@/lib/analysis-history-service";
import type { VaultLocation } from "@/lib/token-storage";
import { withStubbedFetch } from "./helpers/stub-fetch";

const SOURCE_HASH = "a".repeat(64);

function entry(overrides: Partial<PersistedHistoryEntry> = {}): PersistedHistoryEntry {
  return {
    ticketKey: "PROJ-1",
    verdict: "coherent",
    translation: "Le ticket ajoute un champ date.",
    clarification: null,
    analyzedAt: "2026-09-06T09:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    sourceHash: SOURCE_HASH,
    comparisonWindow: "7d",
    ...overrides,
  };
}

function documentWith(...entries: PersistedHistoryEntry[]): PersistedHistoryDocument {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, analyses: entries };
}

function snapshot(updatedAt: string | null): TicketSnapshot {
  return {
    key: "PROJ-1",
    title: "Champ date",
    body: "Ajouter un champ date.",
    updatedAt,
  };
}

async function withTempHistoryVault<T>(
  run: (location: VaultLocation) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "bcc-history-service-"));
  const location = defaultHistoryVaultLocation(directory);
  try {
    return await run(location);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Charge un magasin contenant l'entrée `PROJ-1` analysée le 2026-09-05 (snapshot). */
async function seededStore(
  location: VaultLocation,
): Promise<ReturnType<typeof createAnalysisHistoryStore>> {
  const store = createAnalysisHistoryStore(location);
  const written = await store.write(documentWith(entry()));
  assert.equal(written.status, "written");
  return store;
}

describe("lookupTicketAnalysis — relecture", () => {
  test("aucun enregistrement → `never_analyzed`, SANS consulter Jira (aucun appel à fetchTicket)", async () => {
    await withTempHistoryVault(async (location) => {
      const store = createAnalysisHistoryStore(location); // coffre absent
      let fetchCalls = 0;
      const deps = {
        fetchTicket: async () => {
          fetchCalls += 1;
          return snapshot("2026-09-07T08:00:00.000Z");
        },
      };
      const response = await lookupTicketAnalysis(store, "PROJ-1", deps);
      // « Jamais analysé » est un état à part entière, jamais un résultat connu vide.
      assert.deepEqual(response, { status: "never_analyzed" });
      assert.equal(fetchCalls, 0, "un ticket jamais analysé ne doit pas déclencher de lecture Jira");
    });
  });

  test("enregistrement présent mais autre clé demandée → `never_analyzed`", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const response = await lookupTicketAnalysis(store, "PROJ-2");
      assert.deepEqual(response, { status: "never_analyzed" });
    });
  });

  test("résultat connu et ticket non modifié → `success`, staleness fresh, forme EXACTE du contrat", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const deps = {
        fetchTicket: async () => snapshot("2026-09-05T10:00:00.000Z"), // identique au snapshot
      };
      const response = await lookupTicketAnalysis(store, "PROJ-1", deps);
      // `deepEqual` verrouille la forme exacte : ni `sourceHash` ni `ticketKey` ne fuient,
      // aucun champ en plus, aucun en moins.
      assert.deepEqual(response, {
        status: "success",
        record: {
          verdict: "coherent",
          translation: "Le ticket ajoute un champ date.",
          clarification: null,
          analyzedAt: "2026-09-06T09:00:00.000Z",
          updatedAt: "2026-09-05T10:00:00.000Z",
          comparisonWindow: "7d",
        },
        staleness: { status: "fresh" },
      });
    });
  });

  test("ticket modifié dans Jira après l'analyse → `staleSince` = date de modification courante", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const deps = {
        fetchTicket: async () => snapshot("2026-09-07T08:00:00.000Z"), // modifié depuis le 05
      };
      const response = await lookupTicketAnalysis(store, "PROJ-1", deps);
      assert.equal(response.status, "success");
      if (response.status !== "success") return;
      assert.deepEqual(response.staleness, {
        status: "stale",
        staleSince: "2026-09-07T08:00:00.000Z",
      });
    });
  });

  test("coffre d'historique illisible → variante `error` (200 applicatif), jamais `never_analyzed`", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(location.configPath, "{corrompu", "utf8");
      const response = await lookupTicketAnalysis(store, "PROJ-1");
      assert.equal(response.status, "error");
      if (response.status === "error") {
        assert.equal(response.message.length > 0, true);
        assert.equal(response.message.includes("PROJ-1"), false);
      }
    });
  });
});

describe("lookupTicketAnalysis — « non câblé » ≠ panne, état courant indisponible", () => {
  test("dépendance par défaut (non câblée) → `unknown`, la raison dit « non câblé », pas une panne", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const response = await lookupTicketAnalysis(store, "PROJ-1", defaultHistoryLookupDependencies());
      assert.equal(response.status, "success");
      if (response.status !== "success") return;
      assert.equal(response.staleness.status, "unknown");
      if (response.staleness.status === "unknown") {
        assert.equal(response.staleness.reason.includes("câblée"), true);
        assert.equal(response.staleness.reason.includes("Réessaye"), false);
      }
    });
  });

  test("panne réelle du récupérateur → `unknown` avec raison de panne (distincte du non-câblé)", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const deps = {
        fetchTicket: async () => {
          throw new Error("incident réseau");
        },
      };
      const response = await lookupTicketAnalysis(store, "PROJ-1", deps);
      assert.equal(response.status, "success");
      if (response.status !== "success") return;
      assert.equal(response.staleness.status, "unknown");
      if (response.staleness.status === "unknown") {
        assert.equal(response.staleness.reason.includes("câblée"), false);
        assert.equal(response.staleness.reason.includes("Réessaye"), true);
        assert.equal(response.staleness.reason.includes("incident réseau"), false);
      }
    });
  });

  test("ticket introuvable (fetchTicket → null) → `unknown`, jamais présenté comme frais", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const deps = { fetchTicket: async () => null };
      const response = await lookupTicketAnalysis(store, "PROJ-1", deps);
      assert.equal(response.status, "success");
      if (response.status !== "success") return;
      assert.equal(response.staleness.status, "unknown");
    });
  });

  test("snapshot courant sans date de modification → `unknown`", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const deps = { fetchTicket: async () => snapshot(null) };
      const response = await lookupTicketAnalysis(store, "PROJ-1", deps);
      assert.equal(response.status, "success");
      if (response.status !== "success") return;
      assert.equal(response.staleness.status, "unknown");
    });
  });

  test("le résultat connu est renvoyé même quand la fraîcheur est `unknown` (avec sa raison)", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      const response = await lookupTicketAnalysis(store, "PROJ-1", defaultHistoryLookupDependencies());
      assert.equal(response.status, "success");
      if (response.status !== "success") return;
      assert.equal(response.record.verdict, "coherent");
      assert.equal(response.record.translation, "Le ticket ajoute un champ date.");
    });
  });
});

describe("lookupTicketAnalysis — aucun appel réseau ni IA sur ce chemin", () => {
  test("seule la dépendance injectée est consultée : le `fetch` global ne doit jamais partir", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      let fetchCalls = 0;
      const deps = {
        // Le seul point externe du chemin. Ce module n'a AUCUNE dépendance de complétion
        // (garantie structurelle, vérifiée à la compilation) : un « appel IA » est
        // impossible à écrire ici, et aucun `fetch` global ne doit non plus partir.
        fetchTicket: async () => {
          fetchCalls += 1;
          return snapshot("2026-09-07T08:00:00.000Z");
        },
      };
      await withStubbedFetch(
        () => {
          throw new Error("Aucun appel réseau ne doit partir de la relecture (BACK-9).");
        },
        async () => {
          const response = await lookupTicketAnalysis(store, "PROJ-1", deps);
          assert.equal(response.status, "success");
          if (response.status === "success") {
            assert.deepEqual(response.staleness, {
              status: "stale",
              staleSince: "2026-09-07T08:00:00.000Z",
            });
          }
        },
      );
      assert.equal(fetchCalls, 1);
    });
  });

  test("la relecture ne déclenche jamais de nouvelle analyse (aucune complétion dans le chemin)", async () => {
    await withTempHistoryVault(async (location) => {
      const store = await seededStore(location);
      // Le défaut « non câblé » de la relecture est l'erreur du même avenant que le pipeline
      // (`AnalysisNotWiredError`) : la dépendance par défaut la lève, et le module la
      // traduit en `unknown` avec sa raison. Surtout : AUCUNE complétion n'entre dans ce
      // module — le type `HistoryLookupDependencies` n'a pas de champ d'analyse, et la
      // garantie du critère BACK-9 (« aucun nouvel appel IA tant que l'utilisateur n'a pas
      // demandé de relancer ») est structurelle, pas une discipline.
      const defaults = defaultHistoryLookupDependencies();
      await assert.rejects(defaults.fetchTicket("PROJ-1"), AnalysisNotWiredError);

      const response = await lookupTicketAnalysis(store, "PROJ-1", defaults);
      assert.equal(response.status, "success");
      if (response.status !== "success") return;
      assert.equal(response.staleness.status, "unknown");
    });
  });
});
