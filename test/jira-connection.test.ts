/**
 * ARCHI-7 — Surface publique de `lib/jira-connection.ts` (BACK-1), avec un accent sur les
 * régressions du §5 de `docs/qa-reports/2026-09-04-back-1-2-3.md` et leur correctif contrôlé
 * dans `docs/qa-reports/2026-09-04-back-1-2-3-v2.md` : citation du nom d'hôte uniquement s'il
 * ressemble à un domaine, y compris avec un port explicite ; garde sur `credentials`
 * lui-même absent/`null`.
 *
 * `lib/jira-connection.ts` n'expose pas de point d'injection réseau : le `fetch` global est
 * stubbé pour la durée de chaque test (`test/helpers/stub-fetch.ts`), puis restauré.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { testJiraConnection } from "@/lib/jira-connection";
import type { JiraCredentials } from "@/lib/types/settings";

import { networkError, withStubbedFetch } from "./helpers/stub-fetch";

function credentials(overrides: Partial<JiraCredentials> = {}): JiraCredentials {
  return {
    instanceUrl: "https://mon-entreprise.atlassian.net",
    email: "utilisateur@exemple.com",
    apiToken: "ATATT3xFf-jeton-de-test-suffisamment-long",
    ...overrides,
  };
}

describe("testJiraConnection — validation d'entrée, sans appel réseau", () => {
  test("instanceUrl vide -> invalid_url", async () => {
    const result = await testJiraConnection(credentials({ instanceUrl: "" }));
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_url");
  });

  test("instanceUrl malformée -> invalid_url", async () => {
    const result = await testJiraConnection(credentials({ instanceUrl: "pas une url" }));
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_url");
  });

  test("instanceUrl en http:// (non chiffré) -> invalid_url", async () => {
    const result = await testJiraConnection(
      credentials({ instanceUrl: "http://mon-entreprise.atlassian.net" }),
    );
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_url");
  });

  test("identifiants dans l'URL (user:pass@host) -> invalid_url", async () => {
    const result = await testJiraConnection(
      credentials({ instanceUrl: "https://user:pass@mon-entreprise.atlassian.net" }),
    );
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_url");
  });

  test("email vide -> invalid_token", async () => {
    const result = await testJiraConnection(credentials({ email: "" }));
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_token");
  });

  test("email mal formé (sans @) -> invalid_token", async () => {
    const result = await testJiraConnection(credentials({ email: "pas-un-email" }));
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_token");
  });

  test("apiToken vide -> invalid_token", async () => {
    const result = await testJiraConnection(credentials({ apiToken: "" }));
    assert.equal(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid_token");
  });

  test("apiToken avec retour à la ligne -> invalid_token, message ne recopie pas le jeton", async () => {
    const result = await testJiraConnection(credentials({ apiToken: "jeton\navec-retour-ligne" }));
    assert.equal(result.status, "error");
    if (result.status !== "error") return;
    assert.equal(result.code, "invalid_token");
    assert.equal(result.message.includes("avec-retour-ligne"), false);
  });
});

describe("testJiraConnection — régression : credentials lui-même absent/null ne lève jamais", () => {
  test("credentials undefined", async () => {
    const result = await testJiraConnection(undefined as unknown as JiraCredentials);
    assert.equal(result.status, "error");
  });

  test("credentials null", async () => {
    const result = await testJiraConnection(null as unknown as JiraCredentials);
    assert.equal(result.status, "error");
  });

  test("un champ manquant (instanceUrl) ne lève jamais", async () => {
    const result = await testJiraConnection(
      { email: "a@b.com", apiToken: "x" } as unknown as JiraCredentials,
    );
    assert.equal(result.status, "error");
  });
});

describe("testJiraConnection — régression : le nom d'hôte n'est cité que s'il ressemble à un domaine", () => {
  test("un jeton collé par erreur dans le champ URL (aucun point) n'apparaît jamais dans le message", async () => {
    await withStubbedFetch(
      () => Promise.reject(networkError("ENOTFOUND")),
      async () => {
        const result = await testJiraConnection(
          credentials({ instanceUrl: "https://ATATT3xFfGF0-SECRETTOKEN123" }),
        );
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        assert.equal(result.message.toLowerCase().includes("secrettoken123"), false);
      },
    );
  });

  test("régression (2e passe) : un hôte de domaine avec PORT EXPLICITE est toujours cité", async () => {
    await withStubbedFetch(
      () => Promise.reject(networkError("ENOTFOUND")),
      async () => {
        const result = await testJiraConnection(
          credentials({ instanceUrl: "https://jira.entreprise-interne.com:8443" }),
        );
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        // Avant le correctif de la 2e passe QA, `DOMAIN_LIKE` rejetait tout hôte portant un
        // port explicite (le port n'était accepté que suivi d'un point) : le message serait
        // tombé sur le libellé générique. Le correctif place `(:\d+)?` en fin d'expression.
        assert.match(result.message, /jira\.entreprise-interne\.com:8443/);
      },
    );
  });

  test("un hôte de domaine ordinaire (sans port) reste cité", async () => {
    await withStubbedFetch(
      () => Promise.reject(networkError("ENOTFOUND")),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        assert.match(result.message, /mon-entreprise\.atlassian\.net/);
      },
    );
  });
});

describe("testJiraConnection — classification des codes HTTP", () => {
  test("401 -> invalid_token", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 401 })),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "invalid_token");
      },
    );
  });

  test("403 -> invalid_token", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 403 })),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "invalid_token");
      },
    );
  });

  test("404 -> invalid_url (l'API n'est pas trouvée à cette adresse)", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 404 })),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "invalid_url");
      },
    );
  });

  test("429 -> sans code (aucun des quatre ne le décrit), Retry-After lu s'il est valide", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 429, headers: { "retry-after": "30" } })),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        assert.equal(result.code, undefined);
        assert.match(result.message, /30 secondes/);
      },
    );
  });

  test("5xx -> instance_unreachable", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 503 })),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "instance_unreachable");
      },
    );
  });

  test("3xx (redirection) n'est jamais suivie, et sort sans code", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://autre-hote.example.com" } })),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        assert.equal(result.code, undefined);
      },
    );
  });

  test("200 avec un corps reconnaissable (displayName) -> succès", async () => {
    await withStubbedFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ displayName: "Jane Doe", emailAddress: "jane@exemple.com" }), {
            status: 200,
          }),
        ),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.deepEqual(result, { block: "jira", status: "success", account: { accountName: "Jane Doe" } });
      },
    );
  });

  test("200 dont le corps n'a pas la forme attendue (proxy captif) -> échec, pas un succès", async () => {
    await withStubbedFetch(
      () => Promise.resolve(new Response("<html>portail de connexion</html>", { status: 200 })),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status !== "error") return;
        assert.equal(result.code, undefined);
      },
    );
  });

  test("le corps de succès n'expose jamais emailAddress (invariant 4 : displayName seul)", async () => {
    await withStubbedFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ displayName: "Jane Doe", emailAddress: "jane@exemple.com" }), {
            status: 200,
          }),
        ),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "success");
        if (result.status !== "success") return;
        assert.deepEqual(Object.keys(result.account), ["accountName"]);
      },
    );
  });

  test("panne réseau (ENOTFOUND) -> instance_unreachable, cause d'origine non recopiée", async () => {
    await withStubbedFetch(
      () => Promise.reject(networkError("ENOTFOUND")),
      async () => {
        const result = await testJiraConnection(credentials());
        assert.equal(result.status, "error");
        if (result.status === "error") assert.equal(result.code, "instance_unreachable");
      },
    );
  });
});
