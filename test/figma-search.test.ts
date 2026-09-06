/**
 * MCP-3 — distinction panne / aucun résultat de la recherche design system
 * (`lib/figma-search.ts`).
 *
 * C'est la valeur testable réelle du ticket : un outil en échec ne doit JAMAIS ressembler à
 * « aucun composant trouvé » (critère d'acceptation MCP-3). Tout est exercé via un faux
 * exécuteur, sans réseau.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  searchDesignSystem,
  type FigmaSearchExecutor,
} from "@/lib/figma-search";

const executorReturning =
  (value: unknown): FigmaSearchExecutor =>
  async () => value;

const executorThrowing: FigmaSearchExecutor = async () => {
  throw new Error("quota dépassé");
};

describe("searchDesignSystem", () => {
  test("réponse reconnue avec résultats → succès, items extraits", async () => {
    const outcome = await searchDesignSystem(
      "bouton primaire",
      executorReturning([
        { name: "Button", score: 0.98, fileKey: "F1", nodeId: "1:2" },
      ]),
    );
    assert.deepEqual(outcome, {
      status: "success",
      items: [{ name: "Button", score: 0.98, fileKey: "F1", nodeId: "1:2" }],
    });
  });

  test("réponse vide → succès SANS erreur (aucun résultat)", async () => {
    const outcome = await searchDesignSystem("rien", executorReturning([]));
    assert.deepEqual(outcome, { status: "success", items: [] });
  });

  test("enveloppe { items: [] } → succès sans résultat", async () => {
    const outcome = await searchDesignSystem(
      "rien",
      executorReturning({ items: [] }),
    );
    assert.deepEqual(outcome, { status: "success", items: [] });
  });

  test("exécuteur en échec → erreur distincte, sans recopie du détail", async () => {
    const outcome = await searchDesignSystem("bouton", executorThrowing);
    assert.equal(outcome.status, "error");
    assert.ok(
      outcome.status === "error" &&
        outcome.message.includes("search_design_system") &&
        !outcome.message.includes("quota"),
    );
  });

  test("réponse de forme inconnue → erreur (jamais présentée comme « aucun résultat »)", async () => {
    const outcome = await searchDesignSystem(
      "bouton",
      executorReturning({ unexpected: true }),
    );
    assert.equal(outcome.status, "error");
  });

  test("entrée sans clé ni node-id → ignorée, pas un throw", async () => {
    const outcome = await searchDesignSystem(
      "bouton",
      executorReturning([{ name: "Incomplet", score: 0.5 }]),
    );
    assert.deepEqual(outcome, { status: "success", items: [] });
  });
});
