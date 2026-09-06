/**
 * BACK-6 — la frontière HTTP de `GET /api/analysis/scope-count` : la fonction `GET` exportée
 * par `app/api/analysis/scope-count/route.ts` est importée et appelée telle quelle, avec de
 * vraies `Request`/`Response`. Rien n'est réimplémenté ici.
 *
 * La route appelle `resolveComparisonScope` SANS options (code de production), donc aucun cas
 * de test ne peut injecter de `fetchImpl` : les cas choisis sont ceux qui ne font PAS de
 * réseau par construction — mode manuel (`none`, `epic_component` : ni coffre ni réseau) et
 * mode Jira sans connexion (coffre absent : le resolver répond avant tout appel réseau). Les
 * cas réseau du resolver (liens, repli, paliers, réessais…) sont déjà couverts par
 * `test/jira-scope.test.ts` au niveau du module — inutile de les rejouer ici à travers la
 * route, et impossible sans instance Jira réelle.
 *
 * ISOLATION DU COFFRE — même mécanisme que `test/settings-route.test.ts` : la route appelle
 * `getSettingsStore()` SANS argument (code de production), donc le coffre vaut
 * `defaultVaultLocation()`, c'est-à-dire `join(homedir(), ".bcc")` ; `lib/token-storage.ts`
 * appelle `homedir()` À L'APPEL. Le point d'injection est donc `process.env.HOME`, pointé sur
 * un répertoire temporaire dédié à chaque test, restauré et supprimé dans tous les cas.
 * Aucun test ne lit ni n'écrit dans le `~/.bcc` de l'utilisateur. Les tests `400` ne touchent
 * pas le coffre (la garde précède le resolver), mais ils sont isolés quand même : une
 * régression qui lirait le coffre avant la garde ne doit pas tomber sur le vrai `~/.bcc`.
 *
 * RÉSOLUTION DE `next/server` — la route importe `NextResponse` depuis `next/server`. Le hook
 * de résolution ci-dessous est la méthode d'amorçage de `test/settings-route.test.ts`,
 * recopiée à l'identique (deux obstacles propres au chargement ESM de Node, tous deux traités
 * par ce hook — voir l'en-tête de ce fichier pour le détail) : `next` ne déclare pas
 * d'`exports`, et le chargeur CommonJS de `next/server.js` n'accepte pas les URL `file://`
 * que `test/alias-hook.mjs` passe en spécificateur. Le hook est enregistré AVANT le chargement
 * dynamique de la route, qui n'est donc jamais importée statiquement ici.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { withStubbedFetch } from "./helpers/stub-fetch";

/* -------------------------------------------------------------------------- */
/* Hook de résolution (recopié de test/settings-route.test.ts, voir en-tête)  */
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
async function loadRoute(): Promise<typeof import("@/app/api/analysis/scope-count/route")> {
  return import("@/app/api/analysis/scope-count/route");
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
 * défaut de la route (`$HOME/.bcc`) isolé. `HOME` est restauré et le répertoire supprimé dans
 * tous les cas (motif identique à `test/settings-route.test.ts`).
 */
async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "bcc-scope-count-route-"));
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
/* Requêtes et garde « aucun appel réseau »                                    */
/* -------------------------------------------------------------------------- */

function scopeCountRequest(query?: Record<string, string>): Request {
  const base = "http://localhost/api/analysis/scope-count";
  if (query === undefined) {
    return new Request(base);
  }
  return new Request(`${base}?${new URLSearchParams(query).toString()}`);
}

/** Corps JSON de réponse, sous forme d'objet — le handler renvoie toujours un objet. */
async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert.equal(typeof body === "object" && body !== null && !Array.isArray(body), true);
  return body as Record<string, unknown>;
}

/**
 * Extrait `message` du corps et garantit qu'il s'agit d'une chaîne non vide — les variantes
 * d'erreur du contrat (`400` comme `200 status: "error"`) portent toutes un `message` requis.
 * `assert.fail` étant typé `never`, la garde affine le type pour la suite.
 */
function expectStringMessage(body: Record<string, unknown>): string {
  const message = body.message;
  if (typeof message !== "string" || message.length === 0) {
    assert.fail("le corps de réponse ne porte pas le `message` string requis par le contrat");
  }
  return message;
}

/**
 * Exécute `run` avec le `fetch` global remplacé par un compteur qui lève : tout appel réseau
 * pendant `run` fait échouer l'assertion finale. Les cas de ce fichier ne doivent JAMAIS
 * atteindre le réseau (voir l'en-tête) — cette garde le prouve, elle ne le permet pas.
 */
async function expectNoNetworkCall(run: () => Promise<void>): Promise<void> {
  let calls = 0;
  await withStubbedFetch(
    () => {
      calls += 1;
      throw new Error("Aucun appel réseau ne doit partir d'ici (scope-count sans instance Jira).");
    },
    run,
  );
  assert.equal(calls, 0, "au moins un appel réseau a été émis alors qu'aucun n'était attendu");
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

describe("BACK-6 — GET /api/analysis/scope-count (vrai handler)", () => {
  test("comparisonWindow absent : 400, message français précis, aucun appel réseau", async () => {
    await withTempHome(async () => {
      await expectNoNetworkCall(async () => {
        const { GET } = await loadRoute();
        const response = await GET(scopeCountRequest());
        assert.equal(response.status, 400);
        const body = await readJsonObject(response);
        const message = expectStringMessage(body);
        assert.equal(message.includes("comparisonWindow"), true);
        assert.equal(message.includes("paliers"), true);
        // Une requête malformée est un 4xx nu — pas de verdict applicatif, pas de count.
        assert.equal("count" in body, false);
        assert.equal("status" in body, false);
      });
    });
  });

  test("comparisonWindow hors des 5 paliers : 400, message français précis", async () => {
    for (const badWindow of ["1y", "30", "6M", ""]) {
      await withTempHome(async () => {
        const { GET } = await loadRoute();
        const response = await GET(scopeCountRequest({ comparisonWindow: badWindow }));
        assert.equal(response.status, 400, `palier « ${badWindow} » non refusé`);
        const body = await readJsonObject(response);
        const message = expectStringMessage(body);
        assert.equal(message.includes("comparisonWindow"), true);
        assert.equal(message.includes("paliers"), true);
        assert.equal("count" in body, false);
      });
    }
  });

  test("ni ticketKey ni scopeHint : 200 success (mode manuel vide → none), count 0, costLevel low, sans coffre ni réseau", async () => {
    await withTempHome(async () => {
      await expectNoNetworkCall(async () => {
        const { GET } = await loadRoute();
        const response = await GET(scopeCountRequest({ comparisonWindow: "7d" }));
        assert.equal(response.status, 200);
        // `deepEqual` verrouille la forme EXACTE du contrat : aucun champ en plus (pas de
        // `method` au niveau HTTP), aucun en moins.
        assert.deepEqual(await response.json(), { status: "success", count: 0, costLevel: "low" });
      });
    });
  });

  test("ticketKey sans Jira connecté (coffre vide) : 200 status error, message précis du resolver, aucun appel réseau", async () => {
    await withTempHome(async () => {
      await expectNoNetworkCall(async () => {
        const { GET } = await loadRoute();
        const response = await GET(scopeCountRequest({ comparisonWindow: "30d", ticketKey: "ABC-1" }));
        assert.equal(response.status, 200);
        const body = await readJsonObject(response);
        // Variante d'erreur du contrat : jamais rabattue sur un « 0 ticket » (décision
        // ARCHI-4 n°3) — le badge ne doit pas mentir.
        assert.equal(body.status, "error");
        assert.equal("count" in body, false);
        assert.equal("costLevel" in body, false);
        const message = expectStringMessage(body);
        // Le message précis du resolver (BACK-5), pas un « échec de connexion » générique.
        assert.equal(message.includes("Jira n'est pas connecté"), true);
        assert.equal(message.includes("Paramètres"), true);
        // Et bien le message de NON-CONNEXION (le resolver ne cite la clé que dans le message
        // 404 « ticket introuvable » — ici elle ne doit pas apparaître).
        assert.equal(message.includes("ABC-1"), false);
      });
    });
  });

  test("scopeHint en mode manuel : 200 success, count 0, costLevel low, aucun appel réseau ni coffre", async () => {
    await withTempHome(async () => {
      await expectNoNetworkCall(async () => {
        const { GET } = await loadRoute();
        const response = await GET(scopeCountRequest({ comparisonWindow: "90d", scopeHint: "Épic Mobile" }));
        assert.equal(response.status, 200);
        // La route n'expose pas la méthode (le contrat `ScopeCountResponse` ne la porte pas) :
        // le resolver répond ici `epic_component` à ZÉRO clé par construction (en-tête de
        // lib/jira-scope.ts, §8 — le corpus manuel n'a pas de clés Jira), déjà vérifié au
        // niveau module par test/jira-scope.test.ts. Au niveau HTTP, seul le count 0 est
        // observable — et il est honnête : en mode manuel, il n'y a aucun ticket Jira à
        // compter, le coût Faible reflète l'absence de corpus, pas un succès vide masqué.
        assert.deepEqual(await response.json(), { status: "success", count: 0, costLevel: "low" });
      });
    });
  });
});
