/**
 * FRONT-2 — choix du bloc à ouvrir au premier affichage de l'écran Connexions
 * (`lib/connexions.ts`).
 *
 * Critères du ticket : les blocs déjà traités (connectés, ou passés pour Figma) démarrent
 * repliés, et le premier bloc non traité s'ouvre. Un seul bloc développé à la fois.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CONNEXION_ORDER, firstBlockToConfigure } from "@/lib/connexions";
import type { SettingsState } from "@/lib/types/settings";

function settings(overrides?: Partial<SettingsState>): SettingsState {
  return {
    jira: { status: "not_connected" },
    figma: { status: "not_connected" },
    ai: { status: "not_connected" },
    onboardingCompleted: false,
    ...overrides,
  };
}

describe("firstBlockToConfigure", () => {
  test("tout est à configurer → Jira s'ouvre en premier", () => {
    assert.equal(firstBlockToConfigure(settings()), "jira");
  });

  test("Jira connecté, Figma et IA non → c'est Figma qui s'ouvre", () => {
    const state = settings({
      jira: {
        status: "connected",
        instanceUrl: "https://acme.atlassian.net",
        email: "dev@acme.example",
        account: { accountName: "Acme" },
      },
    });
    assert.equal(firstBlockToConfigure(state), "figma");
  });

  test("Figma passée (skipped) ne rouvre pas : on passe à l'IA", () => {
    const state = settings({
      jira: {
        status: "connected",
        instanceUrl: "https://acme.atlassian.net",
        email: "dev@acme.example",
        account: { accountName: "Acme" },
      },
      figma: { status: "skipped" },
    });
    assert.equal(firstBlockToConfigure(state), "ai");
  });

  test("tout est traité (connecté/passée) → aucun bloc ne s'ouvre", () => {
    const state = settings({
      jira: {
        status: "connected",
        instanceUrl: "https://acme.atlassian.net",
        email: "dev@acme.example",
        account: { accountName: "Acme" },
      },
      figma: { status: "skipped" },
      ai: { status: "connected", provider: "deepseek" },
    });
    assert.equal(firstBlockToConfigure(state), null);
  });

  test("l'ordre d'affichage est bien Jira, Figma, IA", () => {
    assert.deepEqual([...CONNEXION_ORDER], ["jira", "figma", "ai"]);
  });
});
