/**
 * BACK-4 — la frontière HTTP elle-même : les fonctions `GET` et `POST` exportées par
 * `app/api/settings/route.ts` sont importées et appelées telles quelles, avec de vraies
 * `Request`/`Response`. Rien n'est réimplémenté ici.
 *
 * POURQUOI CE FICHIER EXISTE (audit du 04/09/2026, constat n°3) : `test/settings-service.
 * test.ts` réimplémentait le branchement `absent`/`error`/`success` du `GET` au lieu de
 * l'exécuter. Une régression confondant `error` avec `absent` — exactement ce que le critère
 * d'acceptation du ticket interdit — laissait donc la suite verte. Vérifié à l'exécution après
 * écriture de ce fichier : la régression réintroduite dans `route.ts` fait bien échouer la
 * suite, et sa suppression la remet au vert.
 *
 * ISOLATION DU COFFRE — `route.ts` appelle `getSettingsStore()` SANS argument (c'est le code de
 * production, il n'a pas à porter un point d'injection pour les tests), donc le coffre vaut
 * `defaultVaultLocation()`, c'est-à-dire `join(homedir(), ".bcc")`. `lib/token-storage.ts`
 * appelle `homedir()` À L'APPEL et non au chargement du module — son commentaire dit
 * explicitement que c'est fait pour cela. Le point d'injection retenu est donc `process.env.
 * HOME`, positionné sur un répertoire temporaire dédié à chaque test, restauré dans tous les
 * cas (`finally`), et dont la suppression est VÉRIFIÉE. Aucun test n'écrit dans le `~/.bcc` de
 * l'utilisateur. `node --test` exécute chaque fichier dans un processus distinct et les tests
 * d'un même fichier l'un après l'autre : la bascule de `HOME` ne peut pas fuir vers un autre
 * test.
 *
 * Ce point d'injection survit au partage des magasins introduit par `getSettingsStore()` : la
 * table des magasins est indexée PAR EMPLACEMENT DE COFFRE, et `defaultVaultLocation()` y est
 * résolu à chaque appel. Deux tests sur deux `HOME` temporaires distincts obtiennent donc deux
 * magasins distincts, sans qu'aucune remise à zéro soit nécessaire ; à l'intérieur d'un même
 * test, les requêtes partagent bien la même instance, ce qui est précisément ce qu'exerce
 * « deux sauvegardes en vol simultanément » plus bas.
 *
 * RÉSOLUTION DE `next/server` — `route.ts` importe `NextResponse` depuis `next/server`. Deux
 * obstacles, tous deux propres au chargement par le résolveur ESM de Node (jamais rencontrés
 * par le bundler de Next), et tous deux traités par le hook de résolution ci-dessous plutôt
 * qu'en modifiant `route.ts` ou `test/alias-hook.mjs` (hors périmètre) :
 * 1. le paquet `next` ne déclare aucun champ `exports` ; le spécificateur nu `next/server` n'est
 *    donc pas résolvable en ESM (`ERR_MODULE_NOT_FOUND`, « Did you mean next/server.js ? »).
 * 2. `test/alias-hook.mjs` (ARCHI-7) renvoie ses résolutions à `nextResolve` sous forme d'URL
 *    `file://` passée comme SPÉCIFICATEUR. Le chargeur CommonJS ne l'accepte pas : dès que
 *    `next/server.js` fait un `require("../next-url")`, la résolution échoue. Le hook
 *    ci-dessous, enregistré après lui (donc exécuté avant), résout lui-même les
 *    spécificateurs relatifs venant de `node_modules/` et court-circuite la chaîne.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { defaultVaultLocation, encryptDocument } from "@/lib/token-storage";
import { SETTINGS_SCHEMA_VERSION } from "@/lib/settings-store";

import { withStubbedFetch } from "./helpers/stub-fetch";

/* -------------------------------------------------------------------------- */
/* Hook de résolution (voir en-tête)                                          */
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

/**
 * `registerHooks` existe sur le Node installé (v26, comme le suppose déjà
 * `test/alias-hook.mjs`) mais n'est pas déclaré par `@types/node@20` : sa signature est donc
 * décrite ici, à la forme documentée de l'API, plutôt que d'être passée sous silence par un
 * `@ts-ignore`. Rien n'est supposé du comportement : si l'API manquait, l'import du handler
 * échouerait et toute cette suite avec lui.
 */
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

/**
 * Chargé dynamiquement, et jamais par un `import` statique : le hook ci-dessus doit être
 * enregistré AVANT que `next/server` ne soit résolu.
 */
async function loadRoute(): Promise<typeof import("@/app/api/settings/route")> {
  return import("@/app/api/settings/route");
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
 * tous les cas ; l'échec du nettoyage n'est signalé que s'il n'y a pas déjà une erreur de test
 * à remonter, pour ne pas masquer celle-ci.
 */
async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "bcc-route-test-"));
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

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jiraSuccessResponse(): Response {
  return new Response(JSON.stringify({ displayName: "Jane Doe" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function aiSuccessResponse(): Response {
  return new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function invalidTokenResponse(): Response {
  return new Response(null, { status: 401 });
}

const JIRA_TOKEN = "ATATT3xFf-jeton-route-0001";
const JIRA_TOKEN_REFUSE = "ATATT3xFf-jeton-route-refuse-0002";
const AI_TOKEN = "sk-ant-jeton-route-0003";

const JIRA_CREDENTIALS = {
  instanceUrl: "https://exemple.atlassian.net",
  email: "jane@exemple.com",
  apiToken: JIRA_TOKEN,
};

/**
 * Écrit un coffre chiffré dont le CONTENU est choisi par le test (ce qu'aucune API publique ne
 * permet, par construction du typage). La clé est celle que la route vient de créer : le
 * document est donc lu par le vrai chemin de déchiffrement, pas injecté après coup.
 */
async function writeCraftedVault(document: unknown): Promise<void> {
  const location = defaultVaultLocation();
  const keyText = await readFile(location.keyPath, "utf8");
  const encrypted = encryptDocument(Buffer.from(keyText.trim(), "base64"), document);
  if (encrypted.status !== "ok") {
    assert.fail(`chiffrement du coffre de test impossible : ${encrypted.message}`);
  }
  await writeFile(location.configPath, encrypted.value, "utf8");
}

/** Document valide de bout en bout, sauf le `code` de `jira.lastError`, choisi par le test. */
function documentWithJiraErrorCode(code: string): unknown {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    jira: {
      status: "not_connected",
      lastError: { message: "L'instance a refusé l'authentification (HTTP 401).", code },
    },
    figma: { status: "not_connected" },
    ai: { status: "not_connected" },
  };
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

describe("BACK-4 — GET /api/settings (vrai handler)", () => {
  test("aucun coffre : 200 et l'état vide, les trois blocs `not_connected`", async () => {
    await withTempHome(async () => {
      const { GET } = await loadRoute();
      const response = await GET();
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: "success",
        settings: {
          jira: { status: "not_connected" },
          figma: { status: "not_connected" },
          ai: { status: "not_connected" },
        },
      });
    });
  });

  test("coffre illisible : `status: \"error\"`, jamais rabattu sur « aucune configuration »", async () => {
    await withTempHome(async () => {
      const { GET, POST } = await loadRoute();

      // Crée un coffre réel par la route elle-même (aucun réseau : Figma « passer l'étape »).
      const created = await POST(jsonRequest({ block: "figma", skipped: true }));
      assert.equal(created.status, 200);

      await writeFile(defaultVaultLocation().configPath, "{corrompu-volontairement", "utf8");

      const response = await GET();
      assert.equal(response.status, 200);
      const body: unknown = await response.json();
      assert.equal(typeof body === "object" && body !== null, true);
      if (typeof body !== "object" || body === null) return;
      // Ce que la conflation `error`/`absent` rendrait faux : le statut, et l'absence de
      // `settings` — un état vide ici renverrait l'utilisateur configuré à l'onboarding.
      assert.equal("status" in body && body.status === "error", true);
      assert.equal("settings" in body, false);
      assert.equal("message" in body && typeof body.message === "string", true);
    });
  });

  test("coffre porteur d'un `code` hors union : illisible, donc `status: \"error\"`", async () => {
    await withTempHome(async () => {
      const { GET, POST } = await loadRoute();
      await POST(jsonRequest({ block: "figma", skipped: true }));

      // Témoin : le même document avec un code DU contrat reste parfaitement lisible.
      await writeCraftedVault(documentWithJiraErrorCode("invalid_token"));
      const temoin: unknown = await (await GET()).json();
      assert.equal(
        typeof temoin === "object" && temoin !== null && "status" in temoin
          ? temoin.status
          : undefined,
        "success",
      );

      await writeCraftedVault(documentWithJiraErrorCode("code-hors-union"));
      const body: unknown = await (await GET()).json();
      assert.equal(typeof body === "object" && body !== null, true);
      if (typeof body !== "object" || body === null) return;
      assert.equal("status" in body && body.status === "error", true);
      assert.equal("settings" in body, false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* POST                                                                       */
/* -------------------------------------------------------------------------- */

describe("BACK-4 — POST /api/settings (vrai handler)", () => {
  test("corps qui n'est pas un JSON valide : 400, et rien n'est écrit", async () => {
    await withTempHome(async () => {
      const { POST } = await loadRoute();
      const response = await POST(
        new Request("http://localhost/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(existsSync(defaultVaultLocation().configPath), false);
    });
  });

  test("corps JSON mais bloc inconnu : 400, et rien n'est écrit", async () => {
    await withTempHome(async () => {
      const { POST } = await loadRoute();
      const response = await POST(jsonRequest({ block: "slack", credentials: {} }));
      assert.equal(response.status, 400);
      assert.equal(existsSync(defaultVaultLocation().configPath), false);
    });
  });

  test("sauvegarde Jira validée : 200, puis GET la retrouve `connected`", async () => {
    await withTempHome(async () => {
      const { GET, POST } = await loadRoute();

      await withStubbedFetch(
        () => Promise.resolve(jiraSuccessResponse()),
        async () => {
          const response = await POST(jsonRequest({ block: "jira", credentials: JIRA_CREDENTIALS }));
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { block: "jira", status: "success" });
        },
      );

      const body: unknown = await (await GET()).json();
      assert.deepEqual(body, {
        status: "success",
        settings: {
          jira: {
            status: "connected",
            instanceUrl: JIRA_CREDENTIALS.instanceUrl,
            email: JIRA_CREDENTIALS.email,
            account: { accountName: "Jane Doe" },
          },
          figma: { status: "not_connected" },
          ai: { status: "not_connected" },
        },
      });
    });
  });

  test("un second POST au jeton refusé rend `status: \"error\"` sans défaire la connexion établie", async () => {
    await withTempHome(async () => {
      const { GET, POST } = await loadRoute();

      await withStubbedFetch(
        () => Promise.resolve(jiraSuccessResponse()),
        async () => {
          await POST(jsonRequest({ block: "jira", credentials: JIRA_CREDENTIALS }));
        },
      );

      await withStubbedFetch(
        () => Promise.resolve(invalidTokenResponse()),
        async () => {
          const response = await POST(
            jsonRequest({
              block: "jira",
              credentials: { ...JIRA_CREDENTIALS, apiToken: JIRA_TOKEN_REFUSE },
            }),
          );
          assert.equal(response.status, 200);
          const body: unknown = await response.json();
          assert.equal(typeof body === "object" && body !== null, true);
          if (typeof body !== "object" || body === null) return;
          assert.equal("status" in body && body.status === "error", true);
          assert.equal(
            "message" in body && typeof body.message === "string" && body.message.length > 0,
            true,
          );
          // Le message d'échec est renvoyé, jamais le jeton qui l'a provoqué.
          assert.equal(JSON.stringify(body).includes(JIRA_TOKEN_REFUSE), false);
        },
      );

      const body: unknown = await (await GET()).json();
      assert.deepEqual(body, {
        status: "success",
        settings: {
          jira: {
            status: "connected",
            instanceUrl: JIRA_CREDENTIALS.instanceUrl,
            email: JIRA_CREDENTIALS.email,
            account: { accountName: "Jane Doe" },
          },
          figma: { status: "not_connected" },
          ai: { status: "not_connected" },
        },
      });
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Concurrence — deux sauvegardes en vol simultanément                        */
/* -------------------------------------------------------------------------- */

/**
 * Le cas nominal de cet endpoint (`docs/api-contracts.md`, §`POST /api/settings`) : chaque bloc
 * est sauvegardé dès sa validation, donc dans le flux du test au blur, et deux sauvegardes
 * peuvent être en vol en même temps.
 *
 * Ce test est à l'ALTITUDE DU SYMPTÔME et pas à celle de la fonction : il passe par les vraies
 * `POST` et `GET` de `route.ts`, et n'observe le résultat que par le `GET` — c'est-à-dire par
 * ce que l'utilisateur voit au rechargement suivant. Un test sur `update()` d'un seul magasin
 * ne l'aurait pas vu, et c'est exactement ce qui a laissé passer le défaut :
 * `test/token-storage.test.ts` couvre bien la sérialisation, mais sur UNE instance, alors que
 * `route.ts` en construisait une par requête.
 *
 * Vérifié à l'exécution en rétablissant temporairement le magasin par requête dans `route.ts` :
 * ce test échoue alors, et il repasse au vert avec `getSettingsStore()`.
 */
describe("BACK-4 — deux sauvegardes en vol simultanément", () => {
  test("deux POST concurrents sur deux blocs : le GET suivant voit les deux, et le troisième intact", async () => {
    await withTempHome(async () => {
      const { GET, POST } = await loadRoute();

      // Coffre et clé créés AVANT la course, par la route elle-même : ce test porte sur
      // l'entrelacement des cycles lecture-modification-écriture, pas sur la création
      // concurrente de la clé de chiffrement.
      const created = await POST(jsonRequest({ block: "figma", skipped: true }));
      assert.equal(created.status, 200);

      let jiraBody: unknown;
      let aiBody: unknown;

      await withStubbedFetch(
        (url) => {
          const asString = typeof url === "string" ? url : url.toString();
          return Promise.resolve(
            asString.includes("atlassian.net") ? jiraSuccessResponse() : aiSuccessResponse(),
          );
        },
        async () => {
          // Aucun `await` entre les deux appels : les deux requêtes sont réellement en vol.
          const [jira, ai] = await Promise.all([
            POST(jsonRequest({ block: "jira", credentials: JIRA_CREDENTIALS })),
            POST(
              jsonRequest({
                block: "ai",
                credentials: { provider: "anthropic", apiToken: AI_TOKEN },
              }),
            ),
          ]);
          assert.equal(jira.status, 200);
          assert.equal(ai.status, 200);
          jiraBody = await jira.json();
          aiBody = await ai.json();
        },
      );

      // Les deux réponses AFFIRMENT une sauvegarde : le disque doit les tenir toutes les deux.
      assert.deepEqual(jiraBody, { block: "jira", status: "success" });
      assert.deepEqual(aiBody, { block: "ai", status: "success" });

      const body: unknown = await (await GET()).json();
      assert.deepEqual(body, {
        status: "success",
        settings: {
          jira: {
            status: "connected",
            instanceUrl: JIRA_CREDENTIALS.instanceUrl,
            email: JIRA_CREDENTIALS.email,
            account: { accountName: "Jane Doe" },
          },
          // Le bloc que la course ne touche pas : une écriture concurrente ne doit pas
          // davantage défaire une sauvegarde antérieure.
          figma: { status: "skipped" },
          ai: { status: "connected", provider: "anthropic" },
        },
      });
    });
  });
});
