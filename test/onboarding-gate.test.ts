/**
 * FRONT-1 — l'aiguillage de l'écran d'accueil (lib/home-gate.ts).
 *
 * Critère d'acceptation du ticket : l'Intro ne s'affiche qu'au premier lancement, décidé
 * par l'état réel de la configuration (`GET /api/settings`), et la variante d'erreur du
 * contrat ne doit JAMAIS être confondue avec un état vide — sinon une panne de lecture
 * resservirait l'onboarding à un utilisateur déjà configuré.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { resolveHomeView } from "@/lib/home-gate";
import type { GetSettingsResponse, SettingsState } from "@/lib/types/settings";

function settingsResponse(onboardingCompleted: boolean): GetSettingsResponse {
  const settings: SettingsState = {
    jira: { status: "not_connected" },
    figma: { status: "not_connected" },
    ai: { status: "not_connected" },
    onboardingCompleted,
  };
  return { status: "success", settings };
}

describe("resolveHomeView", () => {
  test("onboarding non terminé → écran Intro", () => {
    assert.deepEqual(resolveHomeView(settingsResponse(false)), { view: "intro" });
  });

  test("onboarding terminé → espace principal, même si une connexion expire ensuite", () => {
    // Un utilisateur dont le jeton expire après le wizard ne doit pas retomber sur
    // l'Intro : un bloc redevient not_connected sans que ce soit un premier lancement
    // (décision n°2 du 31/08/2026).
    const settings: SettingsState = {
      jira: {
        status: "connected",
        instanceUrl: "https://acme.atlassian.net",
        email: "dev@acme.example",
        account: { accountName: "Acme" },
      },
      figma: { status: "skipped" },
      ai: { status: "connected", provider: "deepseek" },
      onboardingCompleted: true,
    };
    settings.jira = {
      status: "not_connected",
      lastError: { message: "Jeton invalide ou expiré." },
    };
    assert.deepEqual(resolveHomeView({ status: "success", settings }), { view: "main" });
  });

  test("échec de lecture → vue error avec le message du backend, jamais rabattu sur intro", () => {
    const response: GetSettingsResponse = {
      status: "error",
      message: "Coffre illisible.",
    };
    assert.deepEqual(resolveHomeView(response), { view: "error", message: "Coffre illisible." });
  });
});
