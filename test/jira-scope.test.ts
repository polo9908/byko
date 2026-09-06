/**
 * BACK-5 — Surface publique de `lib/jira-scope.ts` (résolution du périmètre de comparaison).
 *
 * Le réseau est mocké par INJECTION (`options.fetchImpl`), jamais par le `fetch` global : ce
 * module expose son point d'injection (comme `lib/ai-connection.ts`), donc la suite n'a pas
 * besoin de `withStubbedFetch`. Le coffre est isolé par `HOME` temporaire, comme
 * `test/settings-route.test.ts` : `lib/jira-scope.ts` appelle `getSettingsStore()` SANS
 * argument (code de production), or `lib/token-storage.ts` résout `defaultVaultLocation()` à
 * l'appel — pointer `HOME` sur un répertoire temporaire isole donc le vrai chemin, sans
 * point d'injection supplémentaire.
 *
 * Le coffre connecté est écrit par le chemin réel de persistance (`store.write` d'un
 * document typé `PersistedSettingsDocument`, encodé par `encodeSettingsDocument`) — jamais un
 * fichier bricolé à la main : la lecture par `lib/jira-scope.ts` emprunte le vrai chemin de
 * déchiffrement.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveComparisonScope, type ResolveScopeOptions, type ScopeResolution } from "@/lib/jira-scope";
import { buildAuthorizationHeader } from "@/lib/jira-connection";
import { createSecret } from "@/lib/secret";
import { getSettingsStore, SETTINGS_SCHEMA_VERSION } from "@/lib/settings-store";
import { defaultVaultLocation } from "@/lib/token-storage";
import type { ScopeCountParams } from "@/lib/types/analysis";
import type { PersistedSettingsDocument } from "@/lib/settings-store";

/* -------------------------------------------------------------------------- */
/* Coffre de test : `HOME` sur un répertoire temporaire, jamais `~/.bcc`       */
/* -------------------------------------------------------------------------- */

const INSTANCE_URL = "https://mon-entreprise.atlassian.net";
const EMAIL = "jane@exemple.com";
const API_TOKEN = "ATATT3xFf-jeton-scope-suffisamment-long-0001";

/** Horloge figée pour tous les tests Jira : les dates JQL attendues sont exactes. */
const NOW = new Date("2026-09-06T12:34:56.789Z");

/** 7d depuis NOW : fenêtre la plus utilisée par les assertions de JQL exacte. */
const START_7D = "2026-08-30T12:34:56.789+0000";

function connectedDocument(): PersistedSettingsDocument {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    jira: {
      status: "connected",
      instanceUrl: INSTANCE_URL,
      email: EMAIL,
      apiToken: createSecret(API_TOKEN),
      account: { accountName: "Jane Doe" },
    },
    figma: { status: "not_connected" },
    ai: { status: "not_connected" },
    onboardingCompleted: true,
  };
}

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
 * défaut (`$HOME/.bcc`) isolé du vrai `~/.bcc` de l'utilisateur. `HOME` est restauré et le
 * répertoire supprimé dans tous les cas.
 */
async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "bcc-scope-test-"));
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

/** Écrit un coffre connecté Jira via le chemin réel (`store.write` → `encode`). */
async function seedConnectedJira(): Promise<void> {
  const store = getSettingsStore();
  const written = await store.write(connectedDocument());
  assert.equal(written.status, "written");
}

/* -------------------------------------------------------------------------- */
/* Réseau mocké par injection                                                 */
/* -------------------------------------------------------------------------- */

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

type StubHandler = (call: RecordedCall, index: number) => Response | Promise<Response>;

/** Fabrique un `fetchImpl` qui enregistre les appels puis délègue à `handler`. */
function fetchFrom(handler: StubHandler): { fetchImpl: ResolveScopeOptions["fetchImpl"]; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: NonNullable<ResolveScopeOptions["fetchImpl"]> = async (url, init) => {
    const call: RecordedCall = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetchImpl, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Réponse du GET issue : liens, parent et composants choisis par le test. */
function issueResponse(overrides: {
  key?: string;
  issuelinks?: unknown[];
  parent?: unknown;
  components?: unknown[];
}): Response {
  return jsonResponse({
    key: overrides.key ?? "ABC-1",
    fields: {
      issuelinks: overrides.issuelinks ?? [],
      parent: overrides.parent ?? null,
      components: overrides.components ?? [],
    },
  });
}

function searchResponse(keys: string[]): Response {
  return jsonResponse({ issues: keys.map((key) => ({ key })), total: keys.length });
}

function linkedIssue(key: string, direction: "outward" | "inward" = "outward"): unknown {
  return direction === "outward"
    ? { id: `link-${key}`, type: { name: "Relates" }, outwardIssue: { key } }
    : { id: `link-${key}`, type: { name: "Relates" }, inwardIssue: { key } };
}

/** Vrai si l'appel est la recherche JQL (par opposition au GET issue). */
function isSearchCall(call: RecordedCall): boolean {
  return call.url.includes("/rest/api/3/search");
}

/** Décode le paramètre `jql` d'un appel de recherche. */
function jqlOf(call: RecordedCall): string {
  const query = new URL(call.url).searchParams.get("jql");
  assert.notEqual(query, null);
  return query ?? "";
}

function authorizationOf(call: RecordedCall): string {
  const headers = call.init.headers as Record<string, string>;
  return headers.Authorization ?? "";
}

async function resolve(params: ScopeCountParams, options: ResolveScopeOptions): Promise<ScopeResolution> {
  return resolveComparisonScope(params, options);
}

/* -------------------------------------------------------------------------- */
/* Mode manuel — aucun Jira, aucun appel réseau                               */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — mode manuel (pas de Jira)", () => {
  test("scopeHint rempli : epic_component, zéro clé, AUCUN appel réseau ni coffre", async () => {
    const { fetchImpl, calls } = fetchFrom(() => {
      throw new Error("le mode manuel ne doit jamais appeler le réseau");
    });
    const result = await resolve(
      { scopeHint: "  Épic Mobile / composant Checkout  ", comparisonWindow: "7d" },
      { fetchImpl, now: NOW },
    );
    assert.deepEqual(result, { status: "success", method: "epic_component", ticketKeys: [] });
    assert.equal(calls.length, 0);
  });

  test("scopeHint absent : none, zéro clé, sans erreur", async () => {
    const { fetchImpl, calls } = fetchFrom(() => {
      throw new Error("le mode manuel ne doit jamais appeler le réseau");
    });
    const result = await resolve({ comparisonWindow: "30d" }, { fetchImpl, now: NOW });
    assert.deepEqual(result, { status: "success", method: "none", ticketKeys: [] });
    assert.equal(calls.length, 0);
  });

  test("scopeHint réduit à des espaces : none, sans erreur", async () => {
    const { fetchImpl } = fetchFrom(() => {
      throw new Error("le mode manuel ne doit jamais appeler le réseau");
    });
    const result = await resolve({ scopeHint: "   ", comparisonWindow: "90d" }, { fetchImpl });
    assert.deepEqual(result, { status: "success", method: "none", ticketKeys: [] });
  });
});

/* -------------------------------------------------------------------------- */
/* Garde d'entrée — ne lève jamais                                             */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — entrées mal formées : erreur, jamais de crash", () => {
  test("input null", async () => {
    const result = await resolveComparisonScope(null as unknown as ScopeCountParams);
    assert.equal(result.status, "error");
  });

  test("fenêtre de comparaison hors des 5 paliers", async () => {
    const result = await resolveComparisonScope(
      { ticketKey: "ABC-1", comparisonWindow: "3d" as ScopeCountParams["comparisonWindow"] },
    );
    assert.equal(result.status, "error");
  });
});

/* -------------------------------------------------------------------------- */
/* Jira non connecté                                                          */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — mode Jira sans connexion", () => {
  test("aucun coffre : erreur précise, aucun appel réseau", async () => {
    await withTempHome(async () => {
      const { fetchImpl, calls } = fetchFrom(() => {
        throw new Error("sans connexion, aucun appel réseau ne doit partir");
      });
      const result = await resolve({ ticketKey: "ABC-1", comparisonWindow: "7d" }, { fetchImpl, now: NOW });
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /Jira n'est pas connecté/);
      assert.match(result.message, /Paramètres/);
      assert.equal(result.message.includes(API_TOKEN), false);
      assert.equal(calls.length, 0);
    });
  });

  test("coffre illisible : erreur, jamais rabattu sur « Jira non connecté »", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      await writeFile(defaultVaultLocation().configPath, "{corrompu-volontairement", "utf8");

      const { fetchImpl, calls } = fetchFrom(() => {
        throw new Error("coffre illisible : aucun appel réseau ne doit partir");
      });
      const result = await resolve({ ticketKey: "ABC-1", comparisonWindow: "7d" }, { fetchImpl, now: NOW });
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /coffre|illisible/i);
      assert.equal(result.message.includes("Jira n'est pas connecté"), false);
      assert.equal(calls.length, 0);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Méthode linked_issues                                                      */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — méthode linked_issues", () => {
  test("des liens existent : ils priment sur epic/component, filtre d'ancienneté appliqué", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom((call) =>
        isSearchCall(call)
          ? searchResponse(["ABC-2", "ABC-3", "ABC-1"])
          : issueResponse({
              issuelinks: [linkedIssue("ABC-2"), linkedIssue("ABC-4", "inward"), linkedIssue("ABC-2")],
              // Parent et composants RENSEIGNÉS : ils doivent être ignorés (précédence).
              parent: { key: "EPIC-9" },
              components: [{ name: "Front" }],
            }),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );

      assert.equal(result.status, "success");
      if (result.status !== "success") return;
      assert.equal(result.method, "linked_issues");
      // ABC-1 (cible, présent par provocation dans la réponse de recherche) exclu ;
      // ABC-2 dédupliqué malgré ses deux liens.
      assert.deepEqual(result.ticketKeys, ["ABC-2", "ABC-3"]);

      assert.equal(calls.length, 2);
      // La recherche porte la liste des liens dédupliqués et le filtre d'ancienneté.
      const search = calls[1];
      assert.equal(isSearchCall(search), true);
      assert.equal(
        jqlOf(search),
        `key in ("ABC-2", "ABC-4") AND updated >= "${START_7D}"`,
      );
      // L'en-tête est exactement celui du connecteur BACK-1 (source unique), et le jeton
      // n'y figure jamais en clair.
      assert.equal(authorizationOf(calls[0]), buildAuthorizationHeader(EMAIL, API_TOKEN));
      assert.equal(authorizationOf(calls[0]).includes(API_TOKEN), false);
    });
  });

  test("des liens existent mais le filtre d'ancienneté vide tout : méthode conservée, zéro clé", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom((call) =>
        isSearchCall(call)
          ? searchResponse([])
          : issueResponse({ issuelinks: [linkedIssue("ABC-2")] }),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "90d" },
        { fetchImpl, now: NOW },
      );

      assert.equal(result.status, "success");
      if (result.status !== "success") return;
      // Règle de précédence (en-tête §7) : les liens existent, on ne retombe pas sur
      // epic/component — même si le corpus après filtre est vide.
      assert.equal(result.method, "linked_issues");
      assert.deepEqual(result.ticketKeys, []);
      assert.equal(calls.length, 2);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Méthode epic_component (repli)                                             */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — méthode epic_component (repli)", () => {
  test("aucun lien, parent + composant : JQL de repli, exclusion de la cible, dédup", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom((call) =>
        isSearchCall(call)
          // La cible ABC-1 matche son propre epic ; ABC-5 est dédoublé par provocation.
          ? searchResponse(["ABC-1", "ABC-5", "ABC-5", "ABC-6"])
          : issueResponse({
              issuelinks: [],
              parent: { key: "EPIC-9" },
              components: [{ name: "Front" }, { name: "API Back" }],
            }),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );

      assert.equal(result.status, "success");
      if (result.status !== "success") return;
      assert.equal(result.method, "epic_component");
      assert.deepEqual(result.ticketKeys, ["ABC-5", "ABC-6"]);

      assert.equal(calls.length, 2);
      const search = calls[1];
      assert.equal(
        jqlOf(search),
        `(parent = "EPIC-9" OR component in ("Front", "API Back")) AND updated >= "${START_7D}"`,
      );
    });
  });

  test("aucun lien, pas de parent mais un composant : repli limité au composant", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom((call) =>
        isSearchCall(call) ? searchResponse(["ABC-7"]) : issueResponse({ issuelinks: [], components: [{ name: "Front" }] }),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );
      assert.equal(result.status, "success");
      if (result.status !== "success") return;
      assert.equal(result.method, "epic_component");
      assert.deepEqual(result.ticketKeys, ["ABC-7"]);
      // Une clause unique reste parenthésée (forme uniforme du repli).
      assert.equal(jqlOf(calls[1]).startsWith(`(component in ("Front")) AND updated >= "`), true);
    });
  });

  test("ni lien, ni epic, ni composant : none SANS erreur, aucune recherche émise", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom((call) => {
        if (isSearchCall(call)) {
          throw new Error("le repli sans epic/component ne doit pas émettre de recherche");
        }
        return issueResponse({ issuelinks: [], parent: null, components: [] });
      });

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );

      assert.deepEqual(result, { status: "success", method: "none", ticketKeys: [] });
      // Une seule requête : le ticket cible. Aucune recherche inutile.
      assert.equal(calls.length, 1);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Filtre d'ancienneté — les 5 paliers (horloge injectée)                     */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — filtre d'ancienneté aux 5 paliers", () => {
  const windows: ReadonlyArray<{ window: ScopeCountParams["comparisonWindow"]; expected: string }> = [
    { window: "7d", expected: "2026-08-30T12:34:56.789+0000" },
    { window: "30d", expected: "2026-08-07T12:34:56.789+0000" },
    { window: "90d", expected: "2026-06-08T12:34:56.789+0000" },
    { window: "6m", expected: "2026-03-06T12:34:56.789+0000" },
    { window: "12m", expected: "2025-09-06T12:34:56.789+0000" },
  ];

  for (const { window, expected } of windows) {
    test(`palier ${window} : repli epic/component filtré sur updated >= ${expected}`, async () => {
      await withTempHome(async () => {
        await seedConnectedJira();
        const { fetchImpl, calls } = fetchFrom((call) =>
          isSearchCall(call)
            ? searchResponse(["ABC-5"])
            : issueResponse({ issuelinks: [], parent: { key: "EPIC-9" } }),
        );

        const result = await resolve({ ticketKey: "ABC-1", comparisonWindow: window }, { fetchImpl, now: NOW });
        assert.equal(result.status, "success");
        if (result.status !== "success") return;
        assert.equal(result.method, "epic_component");
        assert.equal(jqlOf(calls[1]), `(parent = "EPIC-9") AND updated >= "${expected}"`);
      });
    });
  }

  test("palier 30d : la voie linked_issues porte aussi le filtre d'ancienneté", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom((call) =>
        isSearchCall(call)
          ? searchResponse(["ABC-2"])
          : issueResponse({ issuelinks: [linkedIssue("ABC-2")] }),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "30d" },
        { fetchImpl, now: NOW },
      );
      assert.equal(result.status, "success");
      if (result.status !== "success") return;
      assert.equal(
        jqlOf(calls[1]),
        `key in ("ABC-2") AND updated >= "2026-08-07T12:34:56.789+0000"`,
      );
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Résilience : réessais 429/5xx, jamais sur 4xx                              */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — résilience des appels Jira", () => {
  test("503 puis 503 puis 200 : trois tentatives, résolution réussie", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom((call) =>
        isSearchCall(call)
          ? searchResponse(["ABC-5"])
          : call.url.includes("/rest/api/3/issue/")
            ? calls.filter((c) => !isSearchCall(c)).length <= 2
              ? new Response(null, { status: 503 })
              : issueResponse({ issuelinks: [], parent: { key: "EPIC-9" } })
            : jsonResponse({}),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW, retryBaseDelayMs: 1 },
      );
      assert.equal(result.status, "success");
      if (result.status !== "success") return;
      assert.equal(result.method, "epic_component");
      // 2 échecs 503 + 1 succès sur le GET issue, puis 1 recherche.
      assert.equal(calls.length, 4);
    });
  });

  test("429 répété : trois tentatives puis erreur 429 précise, jamais de fuite", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      // Sans en-tête `Retry-After` : le repli exponentiel injecté (1 ms) garde le test rapide.
      const { fetchImpl, calls } = fetchFrom(() => new Response(null, { status: 429 }));

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW, retryBaseDelayMs: 1 },
      );
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /429/);
      assert.match(result.message, /patiente|Attends/i);
      assert.equal(result.message.includes(API_TOKEN), false);
      assert.equal(calls.length, 3);
    });
  });

  test("401 : JAMAIS de réessai, message d'authentification précis", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom(() => new Response(null, { status: 401 }));

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW, retryBaseDelayMs: 1 },
      );
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /authentification/i);
      assert.match(result.message, /reconnecte Jira/i);
      assert.equal(result.message.includes(API_TOKEN), false);
      assert.equal(result.message.includes(EMAIL), false);
      assert.equal(calls.length, 1);
    });
  });

  test("timeout : message précis, sans donnée sensible", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      // Un `fetchImpl` qui ne répond jamais mais abandonne quand le signal de délai
      // (`AbortSignal.timeout` posé par le module) se déclenche — même forme que le rejet
      // que Node produit sur un vrai délai dépassé.
      const hangingFetch: NonNullable<ResolveScopeOptions["fetchImpl"]> = (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl: hangingFetch, now: NOW, timeoutMs: 30 },
      );
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /n'a pas répondu en moins de/i);
      assert.equal(result.message.includes(API_TOKEN), false);
    });
  });

  test("panne réseau (ENOTFOUND) : message DNS précis", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const networkFailure = () => {
        const cause = new Error("ENOTFOUND") as Error & { code?: string };
        cause.code = "ENOTFOUND";
        const error = new Error("fetch failed") as Error & { cause?: unknown };
        error.cause = cause;
        return Promise.reject(error);
      };
      const fetchImpl: NonNullable<ResolveScopeOptions["fetchImpl"]> = () => networkFailure();

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /introuvable \(DNS\)/i);
      assert.equal(result.message.includes(API_TOKEN), false);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Réponses inattendues                                                       */
/* -------------------------------------------------------------------------- */

describe("BACK-5 — réponses Jira inattendues", () => {
  test("ticket introuvable (404) : message qui nomme la clé, sans donnée sensible", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl, calls } = fetchFrom(() => new Response(null, { status: 404 }));

      const result = await resolve(
        { ticketKey: "ABC-404", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /ABC-404/);
      assert.match(result.message, /introuvable/i);
      assert.equal(result.message.includes(API_TOKEN), false);
      assert.equal(calls.length, 1);
    });
  });

  test("200 non JSON (proxy captif) : erreur, pas un « aucun ticket »", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl } = fetchFrom(() =>
        new Response("<html>portail de connexion</html>", { status: 200 }),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /n'a pas la forme attendue/i);
      assert.equal(result.message.includes(API_TOKEN), false);
    });
  });

  test("recherche 400 (JQL refusée) : message qui distingue la configuration d'instance", async () => {
    await withTempHome(async () => {
      await seedConnectedJira();
      const { fetchImpl } = fetchFrom((call) =>
        isSearchCall(call) ? new Response(null, { status: 400 }) : issueResponse({ issuelinks: [], parent: { key: "EPIC-9" } }),
      );

      const result = await resolve(
        { ticketKey: "ABC-1", comparisonWindow: "7d" },
        { fetchImpl, now: NOW },
      );
      assert.equal(result.status, "error");
      if (result.status !== "error") return;
      assert.match(result.message, /refusé la requête de recherche/i);
      assert.match(result.message, /400/);
    });
  });
});
