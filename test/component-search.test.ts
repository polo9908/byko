/**
 * BACK-8 — recherche et classification de composants (`lib/component-search.ts`).
 *
 * Critères : 3 états distincts et reproductibles pour une même requête ; sans Figma
 * connecté, aucun appel ; une panne de l'outil n'est jamais « à créer ».
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPONENT_SCORE_TIERS,
  classifyComponentScore,
  searchComponents,
  type ComponentSearchDependencies,
} from "@/lib/component-search";
import type { FigmaSearchExecutor } from "@/lib/figma-search";

const deps = (
  figmaConnected: boolean,
  executor: FigmaSearchExecutor,
): ComponentSearchDependencies => ({ figmaConnected, execute: executor });

describe("classifyComponentScore", () => {
  test("3 états distincts et reproductibles", () => {
    assert.equal(classifyComponentScore(0.9), "reusable");
    assert.equal(classifyComponentScore(0.7), "reusable");
    assert.equal(classifyComponentScore(0.55), "to_verify");
    assert.equal(classifyComponentScore(0.4), "to_verify");
    assert.equal(classifyComponentScore(0.1), "to_create");
  });

  test("score non numérique → to_create (rien de pertinent)", () => {
    assert.equal(classifyComponentScore(Number.NaN), "to_create");
  });

  test("la constante est la source unique (bornes croissantes)", () => {
    assert.deepEqual(
      COMPONENT_SCORE_TIERS.map((t) => t.status),
      ["reusable", "to_verify"],
    );
  });
});

describe("searchComponents", () => {
  test("Figma non connecté → succès immédiat, sans appel à l'exécuteur", async () => {
    let called = false;
    const outcome = await searchComponents(
      ["Bouton"],
      deps(false, async () => {
        called = true;
        return [];
      }),
    );
    assert.equal(called, false);
    assert.deepEqual(outcome, { status: "success", figmaConnected: false, components: [] });
  });

  test("aucun besoin → succès, liste vide", async () => {
    const outcome = await searchComponents([], deps(true, async () => []));
    assert.deepEqual(outcome, { status: "success", figmaConnected: true, components: [] });
  });

  test("score fort → reusable + deep-link", async () => {
    const outcome = await searchComponents(
      ["Champ date"],
      deps(true, async () => [{ name: "DateField", score: 0.95, fileKey: "F1", nodeId: "1:2" }]),
    );
    assert.deepEqual(outcome, {
      status: "success",
      figmaConnected: true,
      components: [
        { name: "DateField", status: "reusable", figmaUrl: "https://www.figma.com/file/F1?node-id=1:2" },
      ],
    });
  });

  test("score partiel → to_verify", async () => {
    const outcome = await searchComponents(
      ["Champ date"],
      deps(true, async () => [{ name: "Picker", score: 0.5, fileKey: "F1", nodeId: "3:4" }]),
    );
    assert.equal(outcome.status, "success");
    if (outcome.status === "success") {
      assert.equal(outcome.components[0].status, "to_verify");
    }
  });

  test("aucun résultat → to_create portant le libellé du besoin, sans figmaUrl", async () => {
    const outcome = await searchComponents(["Champ date"], deps(true, async () => []));
    assert.deepEqual(outcome, {
      status: "success",
      figmaConnected: true,
      components: [{ name: "Champ date", status: "to_create" }],
    });
  });

  test("panne de l'outil → erreur propagée, jamais convertie en to_create", async () => {
    const outcome = await searchComponents(
      ["Bouton"],
      deps(true, async () => {
        throw new Error("quota");
      }),
    );
    assert.equal(outcome.status, "error");
  });
});
