/**
 * BACK-10 — `lib/analysis-history.ts` : schéma persisté (encode/decode), magasin chiffré
 * sur répertoire temporaire, enregistrement sérialisé et capacités pures.
 *
 * Mêmes disciplines que `test/settings-store.test.ts` : encode → decode sur littéraux,
 * frontière de parsing stricte (document altéré refusé EN ENTIER, jamais réparé), coffre
 * absent ≠ coffre illisible, et AUCUN test n'écrit dans `~/.bcc` — l'emplacement est
 * `defaultHistoryVaultLocation(<répertoire temporaire>)`, clé `master.key` du même
 * répertoire (même mécanique que la configuration, fichier `history.enc` en plus).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HISTORY_SCHEMA_VERSION,
  createAnalysisHistoryStore,
  decodeHistoryDocument,
  defaultHistoryVaultLocation,
  emptyHistoryDocument,
  encodeHistoryDocument,
  getAnalysisHistoryStore,
  recordAnalysis,
  selectAlreadyAnalyzed,
  upsertHistoryEntry,
  type PersistedHistoryDocument,
  type PersistedHistoryEntry,
} from "@/lib/analysis-history";
import type { VaultLocation } from "@/lib/token-storage";

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

/**
 * Emplacement d'un coffre d'historique dans un répertoire temporaire dédié, supprimé dans
 * tous les cas. `configPath` pointe `history.enc` et `keyPath` `master.key`, comme en
 * production (`defaultHistoryVaultLocation`), sans jamais toucher au vrai `~/.bcc`.
 */
async function withTempHistoryVault<T>(
  run: (location: VaultLocation) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "bcc-history-test-"));
  const location = defaultHistoryVaultLocation(directory);
  try {
    return await run(location);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("encodeHistoryDocument / decodeHistoryDocument — round-trip", () => {
  test("un document à deux entrées (clarification null et non null) survit à encode() puis decode()", () => {
    const document = documentWith(
      entry(),
      entry({
        ticketKey: "PROJ-2",
        verdict: "minor_reservations",
        clarification: "Bonjour, avant de démarrer PROJ-2, une précision est nécessaire :\n1. Quelle plage ?",
        updatedAt: "2026-09-04T08:00:00.000Z",
        sourceHash: "b".repeat(64),
        comparisonWindow: "30d",
      }),
    );
    const encoded = encodeHistoryDocument(document);
    const decoded = decodeHistoryDocument(encoded);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.value.analyses.length, 2);
    assert.equal(decoded.value.analyses[1].clarification?.includes("PROJ-2"), true);
    assert.equal(decoded.value.analyses[0].clarification, null);
  });

  test("document vide (premier lancement) → décode, liste vide", () => {
    const decoded = decodeHistoryDocument(encodeHistoryDocument(emptyHistoryDocument()));
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.deepEqual(decoded.value.analyses, []);
  });
});

describe("decodeHistoryDocument — frontière stricte, aucune donnée inventée", () => {
  const base = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    analyses: [entry()],
  };

  test("document racine non reconnu (tableau, chaîne, null) → refusé", () => {
    for (const raw of [[], "texte", null, 42]) {
      const result = decodeHistoryDocument(raw);
      assert.equal(result.ok, false, `racine ${JSON.stringify(raw)} non refusée`);
    }
  });

  test("schemaVersion différente → refusé, jamais interprété de travers", () => {
    const result = decodeHistoryDocument({ ...base, schemaVersion: 999 });
    assert.equal(result.ok, false);
  });

  test("analyses absente ou non-tableau → refusé", () => {
    for (const analyses of [undefined, {}, "PROJ-1"]) {
      const result = decodeHistoryDocument({ schemaVersion: HISTORY_SCHEMA_VERSION, analyses });
      assert.equal(result.ok, false);
    }
  });

  test("verdict hors des 3 niveaux → refusé", () => {
    const result = decodeHistoryDocument({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      analyses: [entry({ verdict: "peut-être" as never })],
    });
    assert.equal(result.ok, false);
  });

  test("translation vide ou absente → refusé", () => {
    for (const translation of ["", undefined]) {
      const result = decodeHistoryDocument({
        schemaVersion: HISTORY_SCHEMA_VERSION,
        analyses: [{ ...entry(), translation } as never],
      });
      assert.equal(result.ok, false);
    }
  });

  test("clarification ni chaîne ni null → refusé", () => {
    const result = decodeHistoryDocument({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      analyses: [{ ...entry(), clarification: 42 } as never],
    });
    assert.equal(result.ok, false);
  });

  test("updatedAt absente ou vide → refusé (elle porte la détection de mise à jour)", () => {
    for (const updatedAt of [undefined, ""]) {
      const result = decodeHistoryDocument({
        schemaVersion: HISTORY_SCHEMA_VERSION,
        analyses: [{ ...entry(), updatedAt } as never],
      });
      assert.equal(result.ok, false);
    }
  });

  test("sourceHash pas une empreinte SHA-256 hexadécimale de 64 caractères → refusé", () => {
    for (const sourceHash of ["court", "G".repeat(64), undefined]) {
      const result = decodeHistoryDocument({
        schemaVersion: HISTORY_SCHEMA_VERSION,
        analyses: [{ ...entry(), sourceHash } as never],
      });
      assert.equal(result.ok, false);
    }
  });

  test("comparisonWindow hors des 5 paliers → refusé", () => {
    const result = decodeHistoryDocument({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      analyses: [entry({ comparisonWindow: "1y" as never })],
    });
    assert.equal(result.ok, false);
  });

  test("la même clé deux fois → refusé (le « dernier résultat » deviendrait indécidable)", () => {
    const result = decodeHistoryDocument({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      analyses: [entry(), entry({ analyzedAt: "2026-09-07T09:00:00.000Z" })],
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok || result.message.length > 0, true);
  });

  test("messages de refus génériques : aucune valeur du document n'est recopiée", () => {
    const result = decodeHistoryDocument({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      analyses: [{ ticketKey: "PROJ-1", verdict: "coherent", translation: "contenu sensible" }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message.includes("PROJ-1"), false);
    assert.equal(result.message.includes("contenu sensible"), false);
  });
});

describe("createAnalysisHistoryStore — coffre chiffré sur répertoire temporaire", () => {
  test("write() puis read() restitue les entrées exactement (fermer/rouvrir l'app)", async () => {
    await withTempHistoryVault(async (location) => {
      const store = createAnalysisHistoryStore(location);
      const written = await store.write(documentWith(entry()));
      assert.equal(written.status, "written");

      const reopened = createAnalysisHistoryStore(location);
      const read = await reopened.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.analyses.length, 1);
      assert.equal(read.value.analyses[0].translation, "Le ticket ajoute un champ date.");
    });
  });

  test("read() sur un coffre inexistant rend `absent`, pas une liste vide fabriquée", async () => {
    await withTempHistoryVault(async (location) => {
      const store = createAnalysisHistoryStore(location);
      const result = await store.read();
      assert.deepEqual(result, { status: "absent" });
    });
  });

  test("coffre illisible → `error`, jamais confondu avec `absent`", async () => {
    await withTempHistoryVault(async (location) => {
      const store = createAnalysisHistoryStore(location);
      await store.write(emptyHistoryDocument());
      await writeFile(location.configPath, "{corrompu", "utf8");
      const result = await store.read();
      assert.equal(result.status, "error");
    });
  });

  test("le contenu des tickets ne transite jamais en clair sur le disque (coffre chiffré)", async () => {
    await withTempHistoryVault(async (location) => {
      const store = createAnalysisHistoryStore(location);
      await store.write(documentWith(entry({ translation: "contenu-sensible-jamais-en-clair" })));
      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw.includes("contenu-sensible-jamais-en-clair"), false);
    });
  });
});

describe("recordAnalysis / upsertHistoryEntry — un enregistrement par ticketKey", () => {
  test("recordAnalysis remplace l'entrée de la même clé et ajoute les autres", async () => {
    await withTempHistoryVault(async (location) => {
      const store = createAnalysisHistoryStore(location);
      assert.equal((await recordAnalysis(store, entry())).status, "written");
      assert.equal(
        (await recordAnalysis(store, entry({ analyzedAt: "2026-09-07T09:00:00.000Z" }))).status,
        "written",
      );
      assert.equal((await recordAnalysis(store, entry({ ticketKey: "PROJ-2" }))).status, "written");

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.analyses.length, 2);
      const proj1 = read.value.analyses.find((item) => item.ticketKey === "PROJ-1");
      assert.equal(proj1?.analyzedAt, "2026-09-07T09:00:00.000Z");
    });
  });

  test("upsertHistoryEntry est pur : l'entrée d'origine du document n'est pas mutée", () => {
    const document = documentWith(entry({ analyzedAt: "2026-09-06T09:00:00.000Z" }));
    const updated = upsertHistoryEntry(document, entry({ analyzedAt: "2026-09-08T09:00:00.000Z" }));
    assert.equal(document.analyses.length, 1);
    assert.equal(document.analyses[0].analyzedAt, "2026-09-06T09:00:00.000Z");
    assert.equal(updated.analyses.length, 1);
    assert.equal(updated.analyses[0].analyzedAt, "2026-09-08T09:00:00.000Z");
  });

  test("coffre d'historique corrompu : recordAnalysis refuse d'écraser ce qu'il n'a pas su lire", async () => {
    await withTempHistoryVault(async (location) => {
      const store = createAnalysisHistoryStore(location);
      await store.write(documentWith(entry()));
      await writeFile(location.configPath, "{corrompu", "utf8");
      const result = await recordAnalysis(store, entry({ ticketKey: "PROJ-2" }));
      assert.equal(result.status, "error");
    });
  });
});

describe("getAnalysisHistoryStore — magasin partagé par emplacement", () => {
  test("deux appels sous le même HOME → la même instance (file d'écriture partagée)", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "bcc-history-shared-"));
    process.env.HOME = tempHome;
    try {
      assert.equal(getAnalysisHistoryStore(), getAnalysisHistoryStore());
    } finally {
      process.env.HOME = originalHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test("deux enregistrements concurrents (Promise.all) ne se perdent pas", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "bcc-history-concurrent-"));
    process.env.HOME = tempHome;
    try {
      const store = getAnalysisHistoryStore();
      const results = await Promise.all([
        recordAnalysis(store, entry()),
        recordAnalysis(store, entry({ ticketKey: "PROJ-2", sourceHash: "b".repeat(64) })),
      ]);
      assert.equal(results.every((r) => r.status === "written"), true);

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      // Les deux écritures ont survécu : la file d'écriture de l'instance partagée a
      // sérialisé les cycles lecture-modification-écriture. Avec une instance par requête,
      // la perdante aurait répondu `written` sans avoir été écrite.
      assert.deepEqual(
        read.value.analyses.map((item) => item.ticketKey).sort(),
        ["PROJ-1", "PROJ-2"],
      );
    } finally {
      process.env.HOME = originalHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

describe("selectAlreadyAnalyzed — capacité pure pour le futur flag alreadyAnalyzed", () => {
  test("renvoie, dans l'ordre d'entrée, les clés présentes dans l'historique", () => {
    const document = documentWith(entry(), entry({ ticketKey: "PROJ-2" }));
    assert.deepEqual(selectAlreadyAnalyzed(document.analyses, ["PROJ-3", "PROJ-1", "PROJ-2"]), [
      "PROJ-1",
      "PROJ-2",
    ]);
  });

  test("historique vide → aucune clé déjà analysée", () => {
    assert.deepEqual(selectAlreadyAnalyzed([], ["PROJ-1", "PROJ-2"]), []);
  });
});
