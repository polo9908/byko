/**
 * BACK-4 — logique de `POST`/`GET /api/settings`, testée via les mêmes fonctions de `lib/` que
 * `route.ts` appelle (`applySaveSettingsRequest`, `createSettingsStore`, `toSettingsState`).
 *
 * CE QUE CE FICHIER N'EXERCE PAS, et où c'est fait : la frontière HTTP elle-même
 * (`app/api/settings/route.ts` — branchement `absent`/`error`/`success` du `GET`, codes de
 * statut, lecture du corps du `POST`) n'est PAS traversée ici ; elle l'est dans
 * `test/settings-route.test.ts`, qui importe et appelle les vraies fonctions `GET`/`POST`.
 * L'en-tête précédent affirmait que « toute la logique testée ici emprunte exactement le
 * chemin d'une requête réelle » : c'était faux pour ce branchement (audit du 04/09/2026,
 * constat n°3), d'où cette reformulation.
 *
 * Répertoire temporaire (`withTempVault`), jamais `~/.bcc`. Réseau stubbé
 * (`withStubbedFetch`, comme `test/jira-connection.test.ts` et
 * `test/figma-connection.test.ts`) : aucun appel sortant réel.
 *
 * Traduit les trois critères d'acceptation du ticket BACK-4 et les points demandés en plus :
 * sauvegarde indépendante par bloc, coffre illisible non rabattu sur « aucune configuration »,
 * corps de requête malformés, fichier disque sans jeton en clair.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

import { testAiConnection } from "@/lib/ai-connection";
import { testFigmaConnection } from "@/lib/figma-connection";
import { testJiraConnection } from "@/lib/jira-connection";
import { revealSecret } from "@/lib/secret";
import { emptySettingsState, toSettingsState } from "@/lib/settings-mapper";
import { parseSaveSettingsRequest } from "@/lib/settings-request";
import { applySaveSettingsRequest } from "@/lib/settings-service";
import { createSettingsStore } from "@/lib/settings-store";
import type { GetSettingsResponse } from "@/lib/types/settings";

import { withTempVault } from "./helpers/temp-vault";
import { withStubbedFetch } from "./helpers/stub-fetch";

const JIRA_TOKEN = "ATATT3xFf-jeton-critere-acceptation";
const FIGMA_TOKEN = "figd_jeton-jamais-en-clair-0001";
const AI_TOKEN = "sk-ant-jeton-jamais-en-clair-0002";

/** Jetons de la SECONDE sauvegarde, celle que le provider refuse (401). */
const JIRA_TOKEN_REFUSE = "ATATT3xFf-jeton-refuse-par-le-provider";
const FIGMA_TOKEN_REFUSE = "figd_jeton-refuse-par-le-provider-0003";
const AI_TOKEN_REFUSE = "sk-ant-jeton-refuse-par-le-provider-0004";

const JIRA_INSTANCE = "https://exemple.atlassian.net";
const JIRA_EMAIL = "jane@exemple.com";

function jiraSuccessResponse(): Response {
  return new Response(JSON.stringify({ displayName: "Jane Doe" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function figmaSuccessResponse(): Response {
  return new Response(JSON.stringify({ handle: "jane" }), {
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

/**
 * Lecture + mapping, c'est-à-dire ce que la route fait APRÈS son branchement HTTP. Le
 * branchement lui-même est couvert par `test/settings-route.test.ts` : ce raccourci ne
 * prétend pas le remplacer.
 */
async function readSettings(
  store: ReturnType<typeof createSettingsStore>,
): Promise<GetSettingsResponse> {
  const result = await store.read();
  if (result.status === "absent") {
    return { status: "success", settings: emptySettingsState() };
  }
  if (result.status === "error") {
    return { status: "error", message: result.message };
  }
  return { status: "success", settings: toSettingsState(result.value) };
}

describe("BACK-4 — critère : fermer et rouvrir l'app ne redemande pas le jeton Jira", () => {
  test("un Jira validé puis une nouvelle instance de magasin (rouverture) le retrouve `connected`", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const parsed = parseSaveSettingsRequest({
        block: "jira",
        credentials: {
          instanceUrl: "https://exemple.atlassian.net",
          email: "jane@exemple.com",
          apiToken: JIRA_TOKEN,
        },
      });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(jiraSuccessResponse()),
        async () => {
          const response = await applySaveSettingsRequest(parsed.value, store);
          assert.deepEqual(response, { block: "jira", status: "success" });
        },
      );

      // "Rouverture" : nouvelle instance de magasin sur le même emplacement, sans jamais
      // redemander le jeton — exactement le critère d'acceptation du ticket.
      const reopened = createSettingsStore(location);
      const settings = await readSettings(reopened);
      assert.equal(settings.status, "success");
      if (settings.status !== "success") return;
      assert.deepEqual(settings.settings.jira, {
        status: "connected",
        instanceUrl: "https://exemple.atlassian.net",
        email: "jane@exemple.com",
        account: { accountName: "Jane Doe" },
      });
    });
  });
});

describe("BACK-4 — critère : GET /api/settings ne contient jamais de jeton en clair", () => {
  test("le jeton n'apparaît pas dans le JSON sérialisé de la réponse, sur les trois blocs", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);

      const jira = parseSaveSettingsRequest({
        block: "jira",
        credentials: {
          instanceUrl: "https://exemple.atlassian.net",
          email: "jane@exemple.com",
          apiToken: JIRA_TOKEN,
        },
      });
      const figma = parseSaveSettingsRequest({
        block: "figma",
        credentials: { apiToken: FIGMA_TOKEN },
      });
      const ai = parseSaveSettingsRequest({
        block: "ai",
        credentials: { provider: "anthropic", apiToken: AI_TOKEN },
      });
      assert.equal(jira.ok, true);
      assert.equal(figma.ok, true);
      assert.equal(ai.ok, true);
      if (!jira.ok || !figma.ok || !ai.ok) return;

      await withStubbedFetch(
        (url) => {
          const asString = typeof url === "string" ? url : url.toString();
          if (asString.includes("figma.com")) return Promise.resolve(figmaSuccessResponse());
          if (asString.includes("atlassian.net")) return Promise.resolve(jiraSuccessResponse());
          return Promise.resolve(aiSuccessResponse());
        },
        async () => {
          await applySaveSettingsRequest(jira.value, store);
          await applySaveSettingsRequest(figma.value, store);
          await applySaveSettingsRequest(ai.value, store);
        },
      );

      const settings = await readSettings(store);
      const serialized = JSON.stringify(settings);

      // Cherché dans le TEXTE produit — pas champ par champ — pour couvrir un jeton qui
      // se serait glissé n'importe où dans la réponse, y compris dans `lastError.message`.
      assert.equal(serialized.includes(JIRA_TOKEN), false);
      assert.equal(serialized.includes(FIGMA_TOKEN), false);
      assert.equal(serialized.includes(AI_TOKEN), false);
      // Et l'inverse est vrai : la réponse porte bien les métadonnées non secrètes.
      assert.equal(serialized.includes("Jane Doe"), true);
    });
  });
});

describe("BACK-4 — critère : `skipped` distinct de `not_connected` pour Figma", () => {
  test('{ block: "figma", skipped: true } persiste `skipped`, jamais confondu avec `not_connected`', async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const parsed = parseSaveSettingsRequest({ block: "figma", skipped: true });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;

      const response = await applySaveSettingsRequest(parsed.value, store);
      assert.deepEqual(response, { block: "figma", status: "success" });

      const settings = await readSettings(store);
      assert.equal(settings.status, "success");
      if (settings.status !== "success") return;
      assert.deepEqual(settings.settings.figma, { status: "skipped" });
      assert.notEqual(settings.settings.figma.status, "not_connected");
    });
  });

  test("un Figma jamais configuré reste `not_connected`, jamais `skipped` par défaut", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const settings = await readSettings(store);
      assert.equal(settings.status, "success");
      if (settings.status !== "success") return;
      assert.deepEqual(settings.settings.figma, { status: "not_connected" });
    });
  });
});

describe("BACK-4 — sauvegarde d'un bloc indépendante des deux autres", () => {
  test("sauvegarder Figma après un Jira connecté ne perturbe ni Jira ni l'IA", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);

      const jira = parseSaveSettingsRequest({
        block: "jira",
        credentials: {
          instanceUrl: "https://exemple.atlassian.net",
          email: "jane@exemple.com",
          apiToken: JIRA_TOKEN,
        },
      });
      assert.equal(jira.ok, true);
      if (!jira.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(jiraSuccessResponse()),
        async () => {
          await applySaveSettingsRequest(jira.value, store);
        },
      );

      const figma = parseSaveSettingsRequest({ block: "figma", skipped: true });
      assert.equal(figma.ok, true);
      if (!figma.ok) return;
      await applySaveSettingsRequest(figma.value, store);

      const settings = await readSettings(store);
      assert.equal(settings.status, "success");
      if (settings.status !== "success") return;
      assert.equal(settings.settings.jira.status, "connected");
      assert.equal(settings.settings.figma.status, "skipped");
      assert.equal(settings.settings.ai.status, "not_connected");
    });
  });
});

describe("BACK-4 — verdict d'échec de test : lastError persisté à partir du seul message du test", () => {
  test("un jeton IA refusé n'est pas persisté `connected`, et lastError.message est celui du test, jamais le jeton", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const parsed = parseSaveSettingsRequest({
        block: "ai",
        credentials: { provider: "anthropic", apiToken: AI_TOKEN },
      });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(invalidTokenResponse()),
        async () => {
          const response = await applySaveSettingsRequest(parsed.value, store);
          assert.equal(response.status, "error");
          if (response.status !== "error") return;
          assert.equal(response.message.includes(AI_TOKEN), false);
        },
      );

      const settings = await readSettings(store);
      assert.equal(settings.status, "success");
      if (settings.status !== "success") return;
      assert.equal(settings.settings.ai.status, "not_connected");
      if (settings.settings.ai.status === "not_connected") {
        assert.equal(settings.settings.ai.lastError !== undefined, true);
        assert.equal(settings.settings.ai.lastError?.message.includes(AI_TOKEN), false);
      }
    });
  });
});

describe("BACK-4 — coffre illisible : jamais rabattu sur « aucune configuration »", () => {
  test("un coffre corrompu rend `status: 'error'`, pas un état vide qu'une écriture écraserait", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const parsed = parseSaveSettingsRequest({ block: "figma", skipped: true });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;
      await applySaveSettingsRequest(parsed.value, store);

      await writeFile(location.configPath, "{corrompu-volontairement", "utf8");

      const settings = await readSettings(store);
      assert.equal(settings.status, "error");
    });
  });
});

describe("BACK-4 — le fichier écrit sur disque ne contient pas le jeton en clair", () => {
  test("après une sauvegarde Jira réussie, `config.enc` ne porte que l'enveloppe chiffrée", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const parsed = parseSaveSettingsRequest({
        block: "jira",
        credentials: {
          instanceUrl: "https://exemple.atlassian.net",
          email: "jane@exemple.com",
          apiToken: JIRA_TOKEN,
        },
      });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(jiraSuccessResponse()),
        async () => {
          await applySaveSettingsRequest(parsed.value, store);
        },
      );

      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw.includes(JIRA_TOKEN), false);
    });
  });
});

describe("BACK-4 — corps de requête malformés (rappel d'intégration, cf. settings-request.test.ts)", () => {
  test('{"block":"jira"} sans credentials est refusé avant tout appel réseau ou toute écriture', async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const parsed = parseSaveSettingsRequest({ block: "jira" });
      assert.equal(parsed.ok, false);

      // Rien n'a été écrit : le coffre reste `absent`.
      const result = await store.read();
      assert.equal(result.status, "absent");
    });
  });
});

describe("BACK-4 — un test raté ne détruit pas une connexion déjà validée (audit, constat n°1)", () => {
  test("Jira : après un jeton refusé, le bloc reste `connected` et son Secret est intact", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const valide = parseSaveSettingsRequest({
        block: "jira",
        credentials: { instanceUrl: JIRA_INSTANCE, email: JIRA_EMAIL, apiToken: JIRA_TOKEN },
      });
      const refuse = parseSaveSettingsRequest({
        block: "jira",
        credentials: {
          instanceUrl: JIRA_INSTANCE,
          email: JIRA_EMAIL,
          apiToken: JIRA_TOKEN_REFUSE,
        },
      });
      assert.equal(valide.ok, true);
      assert.equal(refuse.ok, true);
      if (!valide.ok || !refuse.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(jiraSuccessResponse()),
        async () => {
          assert.deepEqual(await applySaveSettingsRequest(valide.value, store), {
            block: "jira",
            status: "success",
          });
        },
      );

      await withStubbedFetch(
        () => Promise.resolve(invalidTokenResponse()),
        async () => {
          // Le message attendu vient du connecteur lui-même, pas d'un libellé recopié ici.
          const verdict = await testJiraConnection({
            instanceUrl: JIRA_INSTANCE,
            email: JIRA_EMAIL,
            apiToken: JIRA_TOKEN_REFUSE,
          });
          if (verdict.status !== "error") {
            assert.fail("le stub 401 doit produire un verdict d'échec");
          }
          assert.deepEqual(await applySaveSettingsRequest(refuse.value, store), {
            block: "jira",
            status: "error",
            message: verdict.message,
          });
        },
      );

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.jira.status, "connected");
      if (read.value.jira.status !== "connected") return;
      assert.equal(revealSecret(read.value.jira.apiToken), JIRA_TOKEN);
      assert.equal(read.value.jira.instanceUrl, JIRA_INSTANCE);
      assert.equal(read.value.jira.email, JIRA_EMAIL);
      assert.deepEqual(read.value.jira.account, { accountName: "Jane Doe" });

      // Le jeton refusé n'a été persisté nulle part, pas même chiffré.
      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw.includes(JIRA_TOKEN_REFUSE), false);
    });
  });

  test("Figma : après un jeton refusé, le bloc reste `connected` et son Secret est intact", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const valide = parseSaveSettingsRequest({
        block: "figma",
        credentials: { apiToken: FIGMA_TOKEN },
      });
      const refuse = parseSaveSettingsRequest({
        block: "figma",
        credentials: { apiToken: FIGMA_TOKEN_REFUSE },
      });
      assert.equal(valide.ok, true);
      assert.equal(refuse.ok, true);
      if (!valide.ok || !refuse.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(figmaSuccessResponse()),
        async () => {
          assert.deepEqual(await applySaveSettingsRequest(valide.value, store), {
            block: "figma",
            status: "success",
          });
        },
      );

      await withStubbedFetch(
        () => Promise.resolve(invalidTokenResponse()),
        async () => {
          const verdict = await testFigmaConnection({ apiToken: FIGMA_TOKEN_REFUSE });
          if (verdict.status !== "error") {
            assert.fail("le stub 401 doit produire un verdict d'échec");
          }
          assert.deepEqual(await applySaveSettingsRequest(refuse.value, store), {
            block: "figma",
            status: "error",
            message: verdict.message,
          });
        },
      );

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.figma.status, "connected");
      if (read.value.figma.status !== "connected") return;
      assert.equal(revealSecret(read.value.figma.apiToken), FIGMA_TOKEN);
      assert.deepEqual(read.value.figma.account, { accountName: "jane" });

      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw.includes(FIGMA_TOKEN_REFUSE), false);
    });
  });

  test("IA : après une clé refusée, le bloc reste `connected` et son Secret est intact", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const valide = parseSaveSettingsRequest({
        block: "ai",
        credentials: { provider: "anthropic", apiToken: AI_TOKEN },
      });
      const refuse = parseSaveSettingsRequest({
        block: "ai",
        credentials: { provider: "anthropic", apiToken: AI_TOKEN_REFUSE },
      });
      assert.equal(valide.ok, true);
      assert.equal(refuse.ok, true);
      if (!valide.ok || !refuse.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(aiSuccessResponse()),
        async () => {
          assert.deepEqual(await applySaveSettingsRequest(valide.value, store), {
            block: "ai",
            status: "success",
          });
        },
      );

      await withStubbedFetch(
        () => Promise.resolve(invalidTokenResponse()),
        async () => {
          const verdict = await testAiConnection({
            provider: "anthropic",
            apiToken: AI_TOKEN_REFUSE,
          });
          if (verdict.status !== "error") {
            assert.fail("le stub 401 doit produire un verdict d'échec");
          }
          assert.deepEqual(await applySaveSettingsRequest(refuse.value, store), {
            block: "ai",
            status: "error",
            message: verdict.message,
          });
        },
      );

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.ai.status, "connected");
      if (read.value.ai.status !== "connected") return;
      assert.equal(revealSecret(read.value.ai.apiToken), AI_TOKEN);
      assert.equal(read.value.ai.provider, "anthropic");

      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw.includes(AI_TOKEN_REFUSE), false);
    });
  });

  test("Figma `skipped` écrase bien un `connected` : c'est une action de l'utilisateur, pas un test raté", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const valide = parseSaveSettingsRequest({
        block: "figma",
        credentials: { apiToken: FIGMA_TOKEN },
      });
      const passe = parseSaveSettingsRequest({ block: "figma", skipped: true });
      assert.equal(valide.ok, true);
      assert.equal(passe.ok, true);
      if (!valide.ok || !passe.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(figmaSuccessResponse()),
        async () => {
          await applySaveSettingsRequest(valide.value, store);
        },
      );

      assert.deepEqual(await applySaveSettingsRequest(passe.value, store), {
        block: "figma",
        status: "success",
      });

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.figma.status, "skipped");

      // Et le jeton précédemment validé a bien disparu du coffre avec lui.
      const raw = await readFile(location.configPath, "utf8");
      assert.equal(raw.includes(FIGMA_TOKEN), false);
    });
  });

  test("un bloc jamais `connected` est bien dégradé en `not_connected` avec son lastError", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const refuse = parseSaveSettingsRequest({
        block: "ai",
        credentials: { provider: "openai", apiToken: AI_TOKEN_REFUSE },
      });
      assert.equal(refuse.ok, true);
      if (!refuse.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(invalidTokenResponse()),
        async () => {
          const response = await applySaveSettingsRequest(refuse.value, store);
          assert.equal(response.status, "error");
        },
      );

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.ai.status, "not_connected");
      if (read.value.ai.status !== "not_connected") return;
      assert.equal(read.value.ai.lastError?.code, "invalid_token");
    });
  });
});

describe("BACK-4 — revealSecret() apparaît uniquement côté persistance (encode)", () => {
  test("un jeton persisté puis relu reste manipulable comme Secret, jamais comme chaîne nue en dehors de encode()", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);
      const parsed = parseSaveSettingsRequest({
        block: "ai",
        credentials: { provider: "gemini", apiToken: AI_TOKEN },
      });
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;

      await withStubbedFetch(
        () => Promise.resolve(aiSuccessResponse()),
        async () => {
          await applySaveSettingsRequest(parsed.value, store);
        },
      );

      const read = await store.read();
      assert.equal(read.status, "loaded");
      if (read.status !== "loaded") return;
      assert.equal(read.value.ai.status, "connected");
      if (read.value.ai.status === "connected") {
        assert.equal(revealSecret(read.value.ai.apiToken), AI_TOKEN);
      }
    });
  });
});

describe("BACK-4 — avenant onboarding : marqueur « configuration terminée »", () => {
  test("sauvegarder l'onboarding passe `onboardingCompleted` à true sans dégrader les blocs", async () => {
    await withTempVault(async (location) => {
      const store = createSettingsStore(location);

      // Un bloc déjà validé, pour vérifier que marquer l'onboarding terminé ne le défait pas.
      const jira = parseSaveSettingsRequest({
        block: "jira",
        credentials: { instanceUrl: JIRA_INSTANCE, email: JIRA_EMAIL, apiToken: JIRA_TOKEN },
      });
      assert.equal(jira.ok, true);
      if (!jira.ok) return;
      await withStubbedFetch(
        () => Promise.resolve(jiraSuccessResponse()),
        async () => {
          assert.deepEqual(await applySaveSettingsRequest(jira.value, store), {
            block: "jira",
            status: "success",
          });
        },
      );

      const onboarding = parseSaveSettingsRequest({
        block: "onboarding",
        onboardingCompleted: true,
      });
      assert.equal(onboarding.ok, true);
      if (!onboarding.ok) return;
      // Aucun appel réseau : le marqueur n'a pas de connecteur à tester.
      assert.deepEqual(await applySaveSettingsRequest(onboarding.value, store), {
        block: "onboarding",
        status: "success",
      });

      const settings = await readSettings(store);
      assert.equal(settings.status, "success");
      if (settings.status !== "success") return;
      assert.equal(settings.settings.onboardingCompleted, true);
      assert.equal(settings.settings.jira.status, "connected");
      assert.equal(settings.settings.figma.status, "not_connected");
      assert.equal(settings.settings.ai.status, "not_connected");
    });
  });
});
