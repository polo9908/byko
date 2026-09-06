/**
 * FRONT-7/FRONT-8/FRONT-9/FRONT-10 — données pures de l'espace de travail
 * (`lib/workspace.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  COST_LEVEL_LABELS,
  COMPONENTS_EMPTY_MESSAGE,
  COMPONENTS_FIGMA_MESSAGE,
  COMPONENTS_NO_SCOPE_MESSAGE,
  COMPONENT_STATUS_LABELS,
  COMPONENT_STATUS_THEMES,
  DEFAULT_COMPARISON_WINDOW,
  VERDICT_LABELS,
  VERDICT_THEMES,
  WINDOW_OPTIONS,
  componentInitials,
  componentsSectionKind,
  formatScopeCount,
  manualScopeIsNone,
  priorityFlagColor,
} from "@/lib/workspace";

describe("window options", () => {
  test("5 paliers fixes, ordre produit, libellés français", () => {
    assert.deepEqual(
      WINDOW_OPTIONS.map((option) => option.value),
      ["7d", "30d", "90d", "6m", "12m"],
    );
    assert.equal(WINDOW_OPTIONS[3].label, "6 mois");
    assert.equal(DEFAULT_COMPARISON_WINDOW, "30d");
  });
});

describe("formatScopeCount", () => {
  test("singulier/pluriel et libellés de coût", () => {
    assert.equal(formatScopeCount(1, "low"), "1 ticket · Coût Faible");
    assert.equal(formatScopeCount(23, "medium"), "23 tickets · Coût Modéré");
    assert.equal(formatScopeCount(45, "high"), "45 tickets · Coût Élevé");
    assert.equal(COST_LEVEL_LABELS.low, "Faible");
  });
});

describe("priorityFlagColor", () => {
  test("priorités Jira connues → couleurs distinctes ; inconnue → neutre", () => {
    assert.notEqual(priorityFlagColor("Highest"), priorityFlagColor("Low"));
    assert.equal(priorityFlagColor("inconnue"), priorityFlagColor("Autre inconnue"));
  });
});

describe("verdicts (FRONT-9)", () => {
  test("3 libellés distincts et 3 couleurs distinctes au premier coup d'œil", () => {
    assert.deepEqual(
      Object.values(VERDICT_LABELS),
      ["Cohérent", "Réserves mineures", "Cassure risquée"],
    );
    const colors = new Set(["coherent", "minor_reservations", "breaking_risk"].map((v) => VERDICT_THEMES[v as keyof typeof VERDICT_THEMES].color));
    assert.equal(colors.size, 3);
  });
});

describe("composants (FRONT-10)", () => {
  test("3 états de composant : libellés exacts du produit", () => {
    assert.deepEqual(
      [COMPONENT_STATUS_LABELS.reusable, COMPONENT_STATUS_LABELS.to_verify, COMPONENT_STATUS_LABELS.to_create],
      ["Recyclable", "À vérifier", "À créer"],
    );
  });

  test("3 thèmes distincts au premier coup d'œil (texte et fond)", () => {
    const statuses = ["reusable", "to_verify", "to_create"] as const;
    const textColors = new Set(statuses.map((s) => COMPONENT_STATUS_THEMES[s].color));
    const backgrounds = new Set(statuses.map((s) => COMPONENT_STATUS_THEMES[s].background));
    assert.equal(textColors.size, 3);
    assert.equal(backgrounds.size, 3);
  });

  test("« À créer » n'est pas une erreur : teinte neutre, pas le rouge des verdicts", () => {
    assert.notEqual(COMPONENT_STATUS_THEMES.to_create.color, VERDICT_THEMES.breaking_risk.color);
  });

  test("les 3 messages d'état sont distincts et non vides (jamais confondus)", () => {
    const messages = new Set([
      COMPONENTS_FIGMA_MESSAGE,
      COMPONENTS_NO_SCOPE_MESSAGE,
      COMPONENTS_EMPTY_MESSAGE,
    ]);
    assert.equal(messages.size, 3);
    for (const message of messages) {
      assert.ok(message.trim().length > 0);
    }
    assert.ok(COMPONENTS_FIGMA_MESSAGE.includes("Figma"));
  });

  test("état d'affichage : Figma non connecté prime sur tout, grille si données réelles", () => {
    // Figma non connecté : aucune recherche n'a eu lieu — message d'incitation, même quand
    // le périmètre serait « none » (priorité assumée et documentée FRONT-10).
    assert.deepEqual(
      componentsSectionKind({ figmaConnected: false, componentsCount: 0, scopeNone: true }),
      { kind: "figma_disconnected" },
    );
    assert.deepEqual(
      componentsSectionKind({ figmaConnected: false, componentsCount: 0, scopeNone: false }),
      { kind: "figma_disconnected" },
    );
    // Avec des recommandations réelles, les cartes s'affichent toujours.
    assert.deepEqual(
      componentsSectionKind({ figmaConnected: true, componentsCount: 3, scopeNone: true }),
      { kind: "cards" },
    );
    assert.deepEqual(
      componentsSectionKind({ figmaConnected: true, componentsCount: 1, scopeNone: false }),
      { kind: "cards" },
    );
  });

  test("grille vide : périmètre « none » distingué de « aucun composant »", () => {
    assert.deepEqual(
      componentsSectionKind({ figmaConnected: true, componentsCount: 0, scopeNone: true }),
      { kind: "scope_none" },
    );
    assert.deepEqual(
      componentsSectionKind({ figmaConnected: true, componentsCount: 0, scopeNone: false }),
      { kind: "no_components" },
    );
  });

  test("manualScopeIsNone : hint vide/absent ⇒ none, rempli ⇒ comparaison possible", () => {
    assert.equal(manualScopeIsNone(undefined), true);
    assert.equal(manualScopeIsNone(""), true);
    assert.equal(manualScopeIsNone("   "), true);
    assert.equal(manualScopeIsNone("Paiement"), false);
    assert.equal(manualScopeIsNone("  Paiement  "), false);
  });

  test("componentInitials : première lettre du nom, jamais de crash sur chaîne vide", () => {
    assert.equal(componentInitials("Button"), "B");
    assert.equal(componentInitials("carte de paiement"), "C");
    assert.equal(componentInitials("   "), "?");
    assert.equal(componentInitials(""), "?");
  });
});
