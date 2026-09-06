/**
 * BACK-9/BACK-10 — la frontière HTTP de `GET /api/analysis/history` : la fonction `GET`
 * exportée par `app/api/analysis/history/route.ts` est importée et appelée telle quelle,
 * avec de vraies `Request`/`Response`. Rien n'est réimplémenté ici.
 *
 * ISOLATION DU COFFRE — même mécanisme que `test/settings-route.test.ts` : la route appelle
 * `getAnalysisHistoryStore()` SANS argument (code de production), donc le coffre vaut
 * `defaultHistoryVaultLocation()`, c'est-à-dire `$HOME/.bcc/history.enc` ; le point
 * d'injection est `process.env.HOME`, pointé sur un répertoire temporaire dédié à chaque
 * test, restauré et supprimé dans tous les cas. L'enregistrement de test est écrit par le
 * chemin réel de persistance (`getAnalysisHistoryStore()` → `recordAnalysis`), jamais un
 * fichier bricolé à la main.
 *
 * La route utilise les dépendances de PRODUCTION (`defaultHistoryLookupDependencies`) : la
 * récupération Jira y est « non câblée ». Les cas qui exigent un récupérateur qui répond
 * (fraîcheur `stale` vérifiée) sont donc couverts au niveau du module
 * (`test/analysis-history-service.test.ts`), où la dépendance est injectable — inutile de
 * les rejouer ici.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  defaultHistoryVaultLocation,
  getAnalysisHistoryStore,
  recordAnalysis,
  type PersistedHistoryEntry,
} from "@/lib/analysis-history";
import { withStubbedFetch } from "./helpers/stub-fetch";

/* -------------------------------------------------------------------------- */
/* Hook de résolution de `next/server` (recopié de test/scope-count-route.test.ts) */
/* -------------------------------------------------------------------------- */

interface ResolveContext {
  readonly parentURL?: string;
  readonly conditions?: readonly string[];
}

interface ResolveResult {
  readonly url: string;
  readonly format?: string | null;
  readonly shortCircuit?: boolean;
}

type NextResolve = (specifier: string, context?: ResolveContext) => ResolveResult;

interface SyncResolveHooks {
  resolve(
    specifier: string,
    context: ResolveContext,
    nextResolve: NextResolve,
  ): ResolveResult;
}

const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: SyncResolveHooks) => void;
};

/** Suffixes essayés par la résolution CommonJS d'un chemin relatif. */
const CJS_CANDIDATES = ["", ".js", ".json", ".node", "/index.js"];

function isFile(url: URL): boolean {
  try {
    return existsSync(url) && statSync(url).isFile();
  } catch {
    return false;
  }
}

function resolveInsideNodeModules(specifier: string, parentURL: string): string | null {
  const base = new URL(specifier, parentURL).href;
  for (const suffix of CJS_CANDIDATES) {
    const candidate = new URL(base + suffix);
    if (isFile(candidate)) {
      return candidate.href;
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      const resolved = nodeModule.createRequire(import.meta.url).resolve("next/server.js");
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    const parent = context.parentURL;
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      typeof parent === "string" &&
      parent.includes("/node_modules/")
    ) {
      const resolved = resolveInsideNodeModules(specifier, parent);
      if (resolved !== null) {
        return { url: resolved, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});

/** Chargé dynamiquement, et jamais par un `import` statique : voir l'en-tête. */
async function loadRoute(): Promise<typeof import("@/app/api/analysis/history/route")> {
  return import("@/app/api/analysis/history/route");
}

/* -------------------------------------------------------------------------- */
/* Coffre de test : `HOME` sur un répertoire temporaire, jamais `~/.bcc`       */
/* -------------------------------------------------------------------------- */

async function removeTempHome(home: string, previousHome: string | undefined): Promise<void> {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  await rm(home, { recursive: true, force: true });
  if (existsSync(home)) {
    throw new Error(`Le répertoire temporaire ${home} n'a pas été supprimé.`);
  }
}

/**
 * Exécute `run` avec `HOME` pointé sur un répertoire temporaire — donc avec le coffre par
 * défaut de la route (`$HOME/.bcc/history.enc`) isolé. `HOME` est restauré et le répertoire
 * supprimé dans tous les cas.
 */
async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "bcc-history-route-"));
  process.env.HOME = home;

  let result: void;
  try {
    result = await run(home);
  } catch (error) {
    await removeTempHome(home, previousHome).catch(() => undefined);
    throw error;
  }
  await removeTempHome(home, previousHome);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Entrée de test et garde réseau                                              */
/* -------------------------------------------------------------------------- */

const SOURCE_HASH = "a".repeat(64);

function entry(): PersistedHistoryEntry {
  return {
    ticketKey: "PROJ-1",
    verdict: "coherent",
    translation: "Le ticket ajoute un champ date.",
    clarification: null,
    analyzedAt: "2026-09-06T09:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    sourceHash: SOURCE_HASH,
    comparisonWindow: "7d",
  };
}

/** Écrit une entrée `PROJ-1` dans le coffre d'historique du HOME courant. */
async function seedEntry(): Promise<void> {
  const store = getAnalysisHistoryStore();
  const written = await recordAnalysis(store, entry());
  assert.equal(written.status, "written");
}

function historyRequest(ticketKey?: string): Request {
  const base = "http://localhost/api/analysis/history";
  const url = ticketKey === undefined ? base : `${base}?${new URLSearchParams({ ticketKey })}`;
  return new Request(url);
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert.equal(typeof body === "object" && body !== null && !Array.isArray(body), true);
  return body as Record<string, unknown>;
}

/**
 * Exécute `run` avec le `fetch` global remplacé par un compteur qui lève : tout appel réseau
 * pendant `run` fait échouer l'assertion finale. Aucun cas de ce fichier ne doit atteindre
 * le réseau (le récupérateur Jira est non câblé, et la route n'a AUCUNE autre sortie).
 */
async function expectNoNetworkCall(run: () => Promise<void>): Promise<void> {
  let calls = 0;
  await withStubbedFetch(
    () => {
      calls += 1;
      throw new Error("Aucun appel réseau ne doit partir de la relecture (BACK-9).");
    },
    run,
  );
  assert.equal(calls, 0, "au moins un appel réseau a été émis alors qu'aucun n'était attendu");
}

describe("BACK-9/BACK-10 — GET /api/analysis/history (vrai handler)", () => {
  test("ticketKey absent : 400, message français précis, aucun accès au coffre", async () => {
    await withTempHome(async () => {
      await expectNoNetworkCall(async () => {
        const { GET } = await loadRoute();
        const response = await GET(historyRequest());
        assert.equal(response.status, 400);
        const body = await readJsonObject(response);
        const message = body.message;
        assert.equal(typeof message, "string");
        assert.equal((message as string).includes("ticketKey"), true);
        // Une requête malformée est un 4xx nu — pas de verdict applicatif.
        assert.equal("status" in body, false);
      });
    });
  });

  test("ticketKey blanc (espaces seuls) : 400, après normalisation trim", async () => {
    await withTempHome(async () => {
      const { GET } = await loadRoute();
      const response = await GET(historyRequest("   "));
      assert.equal(response.status, 400);
    });
  });

  test("coffre absent (jamais analysé) : 200 `never_analyzed`, sans réseau", async () => {
    await withTempHome(async () => {
      await expectNoNetworkCall(async () => {
        const { GET } = await loadRoute();
        const response = await GET(historyRequest("PROJ-1"));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: "never_analyzed" });
      });
    });
  });

  test("résultat connu, récupération Jira non câblée (défaut) : 200 success, résultat + fraîcheur `unknown` qui le dit", async () => {
    await withTempHome(async () => {
      await expectNoNetworkCall(async () => {
        await seedEntry();
        const { GET } = await loadRoute();
        const response = await GET(historyRequest("PROJ-1"));
        assert.equal(response.status, 200);
        const body = await readJsonObject(response);
        assert.equal(body.status, "success");
        const staleness = body.staleness as Record<string, unknown>;
        assert.equal(staleness.status, "unknown");
        assert.equal((staleness.reason as string).includes("câblée"), true);
        // Le résultat connu est renvoyé intégralement, sans les métadonnées internes.
        assert.deepEqual(body.record, {
          verdict: "coherent",
          translation: "Le ticket ajoute un champ date.",
          clarification: null,
          analyzedAt: "2026-09-06T09:00:00.000Z",
          updatedAt: "2026-09-05T10:00:00.000Z",
          comparisonWindow: "7d",
        });
        assert.equal("sourceHash" in (body.record as object), false);
      });
    });
  });

  test("autre clé que l'enregistrement : 200 `never_analyzed`, même coffre peuplé", async () => {
    await withTempHome(async () => {
      await seedEntry();
      const { GET } = await loadRoute();
      const response = await GET(historyRequest("PROJ-2"));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "never_analyzed" });
    });
  });

  test("coffre d'historique illisible : 200 `error`, message du magasin, jamais `never_analyzed`", async () => {
    await withTempHome(async (home) => {
      await seedEntry();
      const location = defaultHistoryVaultLocation();
      assert.equal(location.configPath.startsWith(join(home, ".bcc")), true);
      await writeFile(location.configPath, "{corrompu", "utf8");

      const { GET } = await loadRoute();
      const response = await GET(historyRequest("PROJ-1"));
      assert.equal(response.status, 200);
      const body = await readJsonObject(response);
      assert.equal(body.status, "error");
      assert.equal(typeof body.message, "string");
      assert.equal((body.message as string).length > 0, true);
      assert.equal("record" in body, false);
    });
  });
});
