/**
 * BACK-7 — orchestration de l'analyse (`lib/analysis-runner.ts`).
 *
 * Couvre l'ordre des événements (mode manuel, complétion injectée) et le mode Jira quand le
 * coffre est vide (Jira non connecté → événement d'erreur, sans réseau).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runAnalysis,
  type AnalysisDependencies,
} from "@/lib/analysis-runner";
import type { AnalysisRequest } from "@/lib/types/analysis";

const depsWith = (raw: string): AnalysisDependencies => ({
  complete: async () => raw,
  fetchTicket: async () => ({
    key: "PROJ-1",
    title: "Champ date",
    body: "Ajouter un champ date.",
    updatedAt: "2026-09-05T10:00:00.000Z",
  }),
});

describe("runAnalysis", () => {
  test("mode manuel, verdict ambigu → événements dans l'ordre verdict/clarification/traduction", async () => {
    const request: AnalysisRequest = {
      ticketSource: "manual",
      ticketText: "Ajouter un champ date.",
      comparisonWindow: "7d",
    };
    const events = await runAnalysis(
      request,
      depsWith(
        JSON.stringify({
          verdict: "minor_reservations",
          translation: "Le ticket ajoute un champ date.",
          questions: ["Quelle plage ?"],
        }),
      ),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["verdict", "clarification", "translation"],
    );
  });

  test("mode manuel, verdict coherent → pas d'événement clarification", async () => {
    const request: AnalysisRequest = {
      ticketSource: "manual",
      ticketText: "Ajouter un champ date.",
      comparisonWindow: "7d",
    };
    const events = await runAnalysis(
      request,
      depsWith(JSON.stringify({ verdict: "coherent", translation: "T", questions: [] })),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["verdict", "translation"],
    );
  });

  test("mode Jira sans coffre (Jira non connecté) → un seul événement d'erreur, sans réseau", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "byko-runner-"));
    process.env.HOME = tempHome;
    try {
      const events = await runAnalysis({
        ticketSource: "jira",
        ticketKey: "PROJ-1",
        comparisonWindow: "7d",
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "error");
    } finally {
      process.env.HOME = originalHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
