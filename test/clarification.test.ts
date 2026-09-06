/**
 * ARCHI-5 — conformité du constructeur de message de clarification au gabarit
 * (`lib/prompts/clarification-template.md` + `lib/prompts/clarification.ts`).
 *
 * Verrouille les critères d'acceptation du ticket : le texte produit est toujours conforme
 * au gabarit quel que soit le nombre de questions, et l'intro ne varie jamais d'une analyse
 * à l'autre (elle ne dépend que du nombre de questions, jamais de leur contenu).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildClarificationMessage } from "@/lib/prompts/clarification";

const KEY = "PROJ-123";

describe("buildClarificationMessage", () => {
  test("0 question → chaîne vide (aucune clarification)", () => {
    assert.equal(buildClarificationMessage(KEY, []), "");
  });

  test("1 question → intro singulière exacte, sans liste numérotée", () => {
    const message = buildClarificationMessage(KEY, [
      "Le périmètre inclut-il l'API v2 ?",
    ]);
    assert.equal(
      message,
      "Bonjour, une précision avant de démarrer PROJ-123 : Le périmètre inclut-il l'API v2 ?",
    );
  });

  test("2 questions → intro plurielle exacte suivie d'une liste numérotée", () => {
    const message = buildClarificationMessage(KEY, [
      "Première question ?",
      "Deuxième question ?",
    ]);
    assert.equal(
      message,
      "Bonjour, avant de démarrer PROJ-123, quelques précisions sont nécessaires :\n" +
        "1. Première question ?\n" +
        "2. Deuxième question ?",
    );
  });

  test("3 questions → même intro, liste numérotée jusqu'à 3", () => {
    const message = buildClarificationMessage(KEY, ["Q1 ?", "Q2 ?", "Q3 ?"]);
    assert.equal(
      message,
      "Bonjour, avant de démarrer PROJ-123, quelques précisions sont nécessaires :\n" +
        "1. Q1 ?\n" +
        "2. Q2 ?\n" +
        "3. Q3 ?",
    );
  });

  test("[CLÉ] est remplacé par la clé du ticket, dans les deux variantes", () => {
    assert.equal(
      buildClarificationMessage("ABC-42", ["Question ?"]),
      "Bonjour, une précision avant de démarrer ABC-42 : Question ?",
    );
    assert.ok(
      buildClarificationMessage("ABC-42", ["Q1 ?", "Q2 ?"]).startsWith(
        "Bonjour, avant de démarrer ABC-42, quelques précisions sont nécessaires :",
      ),
    );
  });

  test("l'intro ne change jamais pour N ≥ 1 (elle ne dépend que du nombre, pas du contenu)", () => {
    // Pour N ≥ 2 : intro identique quel que soit N, indépendante du texte des questions.
    const two = buildClarificationMessage(KEY, ["A ?", "B ?"]);
    const three = buildClarificationMessage(KEY, ["C ?", "D ?", "E ?"]);
    const introTwo = two.slice(0, two.indexOf("\n"));
    const introThree = three.slice(0, three.indexOf("\n"));
    assert.equal(introTwo, introThree);

    // Pour N = 1 : l'intro (tout ce qui précède la question) est figée elle aussi.
    assert.ok(
      buildClarificationMessage(KEY, ["Peu importe ?"]).startsWith(
        "Bonjour, une précision avant de démarrer PROJ-123 : ",
      ),
    );
  });
});
