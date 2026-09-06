/**
 * BACK-7 — noyau du pipeline d'analyse (`lib/analysis-pipeline.ts`).
 *
 * Critères d'acceptation : verdict `coherent` → aucune clarification ; ambiguïté → message
 * conforme au gabarit ARCHI-5 (pas de texte libre) ; traduction TOUJOURS présente. Le tout
 * avec une complétion MOCKÉE (aucun réseau, aucun endpoint inventé).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  AnalysisNotWiredError,
  analyzeTicket,
  type AnalyzerCompletion,
  type TicketSnapshot,
} from "@/lib/analysis-pipeline";

const TICKET: TicketSnapshot = {
  key: "PROJ-1",
  title: "Champ date",
  body: "Ajouter un champ date à l'écran.",
  updatedAt: "2026-09-05T10:00:00.000Z",
};

const completionReturning =
  (raw: string): AnalyzerCompletion =>
  async () => raw;

const coherent = completionReturning(
  JSON.stringify({
    verdict: "coherent",
    translation: "Le ticket ajoute un champ date.",
    questions: [],
  }),
);

const ambiguous = completionReturning(
  JSON.stringify({
    verdict: "minor_reservations",
    translation: "Le ticket ajoute un champ date.",
    questions: ["Quelle plage de dates ?", "Fuseau horaire ?"],
  }),
);

describe("analyzeTicket", () => {
  test("verdict coherent → pas de clarification, traduction présente", async () => {
    const outcome = await analyzeTicket(TICKET, [], coherent, new Date("2026-09-06T00:00:00Z"));
    assert.equal(outcome.status, "success");
    if (outcome.status === "success") {
      assert.equal(outcome.result.verdict, "coherent");
      assert.equal(outcome.result.clarification, null);
      assert.equal(outcome.result.translation, "Le ticket ajoute un champ date.");
    }
  });

  test("ambiguïté → clarification conforme au gabarit ARCHI-5 (pas de texte libre)", async () => {
    const outcome = await analyzeTicket(TICKET, [], ambiguous, new Date("2026-09-06T00:00:00Z"));
    assert.equal(outcome.status, "success");
    if (outcome.status === "success") {
      assert.equal(
        outcome.result.clarification,
        "Bonjour, avant de démarrer PROJ-1, quelques précisions sont nécessaires :\n" +
          "1. Quelle plage de dates ?\n" +
          "2. Fuseau horaire ?",
      );
      // La traduction reste présente même en cas d'ambiguïté (critère « toujours »).
      assert.equal(outcome.result.translation, "Le ticket ajoute un champ date.");
    }
  });

  test("horodatage et hash de source présents et déterministes", async () => {
    const a = await analyzeTicket(TICKET, [], coherent, new Date("2026-09-06T00:00:00Z"));
    const b = await analyzeTicket(TICKET, [], coherent, new Date("2026-09-06T00:00:00Z"));
    assert.equal(a.status, "success");
    assert.equal(b.status, "success");
    if (a.status === "success" && b.status === "success") {
      assert.equal(a.result.analyzedAt, "2026-09-06T00:00:00.000Z");
      assert.equal(a.result.sourceHash, b.result.sourceHash);
    }
  });

  test("réponse illisible (JSON invalide) → erreur, pas de crash", async () => {
    const outcome = await analyzeTicket(TICKET, [], completionReturning("pas du JSON"));
    assert.equal(outcome.status, "error");
  });

  test("verdict hors union → erreur", async () => {
    const outcome = await analyzeTicket(
      TICKET,
      [],
      completionReturning(JSON.stringify({ verdict: "peut_etre", translation: "x", questions: [] })),
    );
    assert.equal(outcome.status, "error");
  });

  test("complétion non câblée → message explicite de branchement à venir", async () => {
    const outcome = await analyzeTicket(TICKET, [], async () => {
      throw new AnalysisNotWiredError();
    });
    assert.equal(outcome.status, "error");
    if (outcome.status === "error") {
      assert.match(outcome.message, /pas encore câblée/);
    }
  });
});
