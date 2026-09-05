/**
 * ARCHI-7 — Surface publique de `lib/figma-connection.ts` (BACK-2).
 *
 * `lib/figma-connection.ts` n'expose pas de point d'injection réseau : le `fetch` global
 * est stubbé pour la durée de chaque test (`test/helpers/stub-fetch.ts`), puis restauré.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { testFigmaConnection } from "@/lib/figma-connection";
import type { FigmaCredentials } from "@/lib/types/settings";

import { networkError, withStubbedFetch } from "./helpers/stub-fetch";

function credentials(overrides: Partial<FigmaCredentials> = {}): FigmaCredentials {
  return { apiToken: "figd_jeton-de-test-suffisamment-long", ...overrides };
}

describe("testFigmaConnection — validation du jeton, sans appel réseau", () => {
  test("jeton vide -> invalid_token", async () => {
    const result = await testFigmaConnection(credentials({ apiToken: "" }));
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_token");
  });

  test("jeton avec espace/retour à la ligne -> invalid_token, sans le recopier", async () => {
    const result = await testFigmaConnection(credentials({ apiToken: "figd_avec un espace" }));
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.code, "invalid_token");
    assert.equal(result.message.includes("figd_avec"), false);
  });

  test("credentials sans apiToken ne lève jamais (garde `credentials?.apiToken`)", async () => {
    const result = await testFigmaConnection({} as unknown as FigmaCredentials);
    assert.equal(result.status, "error");
  });

  test("credentials undefined ne lève jamais", async () => {
    const result = await testFigmaConnection(undefined as unknown as FigmaCredentials);
    assert.equal(result.status, "error");
  });
});

describe("testFigmaConnection — classification des codes HTTP", () => {
  test("401 -> invalid_token", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(JSON.stringify({ status: 401, err: "Invalid token" }), { status: 401 })),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "invalid_token");
      },
    );
  });

  test("403 -> invalid_token (droits insuffisants)", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 403 })),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "invalid_token");
      },
    );
  });

  test("429 -> rate_limited, Retry-After lu s'il est exploitable", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 429, headers: { "retry-after": "12" } })),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        assert.equal(result.code, "rate_limited");
        assert.match(result.message, /12 secondes/);
      },
    );
  });

  test("5xx -> erreur sans code (aucun des deux codes du contrat ne le décrit)", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 502 })),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, undefined);
      },
    );
  });

  test("404 (chemin bidon) -> erreur sans code, pas classé invalid_token à tort", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(JSON.stringify({ status: 404, err: "Not found" }), { status: 404 })),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, undefined);
      },
    );
  });

  test("200 avec handle -> succès, accountName = handle", async () => {
    await withStubbedFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "1", handle: "jane.doe", email: "jane@exemple.com" }), {
            status: 200,
          }),
        ),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.deepEqual(result, { block: "figma", status: "success", account: { accountName: "jane.doe" } });
      },
    );
  });

  test("régression : handle absent -> succès SANS account (email n'est jamais un repli)", async () => {
    await withStubbedFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "1", email: "jane@exemple.com" }), { status: 200 }),
        ),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.deepEqual(result, { block: "figma", status: "success" });
      },
    );
  });

  test("200 dont le corps ne ressemble à rien (proxy captif) -> échec, pas un succès vide", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(JSON.stringify({ unrelated: true }), { status: 200 })),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
      },
    );
  });

  test("200 dont le corps n'est pas du JSON -> échec, pas un crash", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response("<html>login</html>", { status: 200 })),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
      },
    );
  });

  test("panne réseau -> erreur sans code, sans recopier la cause d'origine", async () => {
    await withStubbedFetch(
      () => Promise.reject(networkError("ECONNREFUSED")),
      async () => {
        const result = await testFigmaConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        assert.equal(result.message.includes("ECONNREFUSED"), false);
      },
    );
  });
});
