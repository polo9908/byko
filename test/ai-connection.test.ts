/**
 * ARCHI-7 — Surface publique de `lib/ai-connection.ts` (BACK-3), avec un accent sur les
 * régressions listées au §« Contrôle des cinq correctifs » de
 * `docs/qa-reports/2026-09-04-back-1-2-3-v2.md` (et leur découverte initiale dans la version
 * du 04/09/2026 non versionnée).
 *
 * `TestAiConnectionOptions.fetchImpl` est le point d'injection prévu par le module : aucun
 * appel réseau réel n'est fait ici.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { testAiConnection } from "@/lib/ai-connection";
import type { AiCredentials } from "@/lib/types/settings";

function credentials(overrides: Partial<AiCredentials> = {}): AiCredentials {
  return { provider: "openai", apiToken: "sk-un-jeton-de-test-suffisamment-long", ...overrides };
}

/** `fetchImpl` à réponse fixe, quel que soit l'appel. */
function fixedResponse(response: Response): (url: string, init: RequestInit) => Promise<Response> {
  return () => Promise.resolve(response);
}

describe("testAiConnection — régression : un 200 sans content-type JSON n'est jamais un succès", () => {
  test("200 text/html (proxy d'entreprise) -> provider_unavailable, jamais success", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: fixedResponse(
        new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
      ),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "provider_unavailable");
  });

  test("200 sans aucun content-type -> provider_unavailable, jamais success", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: fixedResponse(new Response(null, { status: 200 })),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "provider_unavailable");
  });

  test("200 avec content-type application/json (et variantes) reste un succès", async () => {
    for (const contentType of [
      "application/json",
      "application/json; charset=utf-8",
      "APPLICATION/JSON",
      "application/vnd.api+json",
    ]) {
      const result = await testAiConnection(credentials(), {
        fetchImpl: fixedResponse(
          new Response("{}", { status: 200, headers: { "content-type": contentType } }),
        ),
      });
      assert.deepEqual(result, { block: "ai", status: "success" });
    }
  });
});

describe("testAiConnection — régression : garde sur `credentials` lui-même absent/null", () => {
  test("credentials undefined ne lève jamais (ne remonte pas en TypeError)", async () => {
    const result = await testAiConnection(
      undefined as unknown as AiCredentials,
      { fetchImpl: fixedResponse(new Response(null, { status: 500 })) },
    );
    assert.equal(result.status, "error");
  });

  test("credentials null ne lève jamais", async () => {
    const result = await testAiConnection(
      null as unknown as AiCredentials,
      { fetchImpl: fixedResponse(new Response(null, { status: 500 })) },
    );
    assert.equal(result.status, "error");
  });

  test("provider hors liste fermée ne lève jamais", async () => {
    const result = await testAiConnection(
      { provider: "mistral", apiToken: "x" } as unknown as AiCredentials,
      { fetchImpl: fixedResponse(new Response(null, { status: 500 })) },
    );
    assert.equal(result.status, "error");
  });

  test("apiToken absent ne lève jamais", async () => {
    const result = await testAiConnection(
      { provider: "openai" } as unknown as AiCredentials,
      { fetchImpl: fixedResponse(new Response(null, { status: 500 })) },
    );
    assert.equal(result.status, "error");
  });
});

describe("testAiConnection — classification des codes HTTP en code du contrat", () => {
  test("401 -> invalid_token, avec le libellé exact imposé par la maquette", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: fixedResponse(new Response(null, { status: 401 })),
    });
    assert.deepEqual(result, {
      block: "ai",
      status: "error",
      message: "jeton invalide ou expiré",
      code: "invalid_token",
    });
  });

  test("400 chez un provider dont invalidKeyStatuses inclut 400 (grok) -> invalid_token", async () => {
    const result = await testAiConnection(credentials({ provider: "grok" }), {
      fetchImpl: fixedResponse(new Response(null, { status: 400 })),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_token");
  });

  test("429 -> quota_exceeded", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: fixedResponse(new Response(null, { status: 429 })),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "quota_exceeded");
  });

  test("5xx -> provider_unavailable, code HTTP cité dans le message", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: fixedResponse(new Response(null, { status: 503 })),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.equal(result.code, "provider_unavailable");
      assert.match(result.message, /503/);
    }
  });

  test("statut inattendu (404) -> provider_unavailable (aucun statut hors table n'est un succès)", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: fixedResponse(new Response(null, { status: 404 })),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "provider_unavailable");
  });

  test("apiToken vide -> invalid_token sans appel réseau", async () => {
    let called = false;
    const result = await testAiConnection(credentials({ apiToken: "   " }), {
      fetchImpl: () => {
        called = true;
        return Promise.reject(new Error("ne doit pas être appelé"));
      },
    });
    assert.equal(called, false);
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_token");
  });
});

describe("testAiConnection — panne réseau et timeout", () => {
  test("fetch qui rejette (panne réseau) -> provider_unavailable", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: () => Promise.reject(new Error("network down, ne doit jamais ressortir")),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") {
      assert.equal(result.code, "provider_unavailable");
      assert.equal(result.message.includes("network down"), false);
    }
  });

  test("timeout dépassé -> provider_unavailable, sans lever", async () => {
    const result = await testAiConnection(credentials(), {
      timeoutMs: 1,
      // Le mock respecte le `signal` transmis par `testAiConnection`, exactement comme le
      // ferait `fetch` natif : c'est l'abandon du signal (timeout réel de la fonction),
      // pas une temporisation arbitraire du mock, qui déclenche la branche testée.
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject((init.signal as AbortSignal).reason);
          });
        }),
    });
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "provider_unavailable");
  });
});

describe("testAiConnection — sortie construite champ par champ", () => {
  test("succès ne contient que { block, status }, jamais de credentials", async () => {
    const result = await testAiConnection(credentials(), {
      fetchImpl: fixedResponse(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    });
    assert.deepEqual(Object.keys(result).sort(), ["block", "status"]);
  });
});
