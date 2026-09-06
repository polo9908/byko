/**
 * FRONT-7/FRONT-8 — données pures de l'espace de travail (`lib/workspace.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  COST_LEVEL_LABELS,
  DEFAULT_COMPARISON_WINDOW,
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
