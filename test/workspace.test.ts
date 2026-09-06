/**
 * FRONT-7/FRONT-8 — données pures de l'espace de travail (`lib/workspace.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  COST_LEVEL_LABELS,
  DEFAULT_COMPARISON_WINDOW,
  VERDICT_LABELS,
  VERDICT_THEMES,
  WINDOW_OPTIONS,
  formatScopeCount,
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
