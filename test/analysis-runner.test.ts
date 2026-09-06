/**
 * BACK-7/BACK-8 — orchestration de l'analyse (`lib/analysis-runner.ts`).
 *
 * Couvre l'ordre des événements (mode manuel, complétion injectée), l'étage composants
 * (BACK-8, injecté) et le mode Jira quand le coffre est vide (Jira non connecté → événement
 * d'erreur, sans réseau).
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

const noComponents = async () => ({ status: "success" as const, figmaConnected: false, components: [] });

const depsWith = (raw: string): AnalysisDependencies => ({
  complete: async () => raw,
  fetchTicket: async () => ({
    key: "PROJ-1",
    title: "Champ date",
    body: "Ajouter un champ date.",
    updatedAt: "2026-09-05T10:00:00.000Z",
  }),
  searchComponents: noComponents,
});

describe("runAnalysis", () => {
  test("mode manuel, verdict ambigu → ordre verdict/clarification/traduction/components", async () => {
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
          needs: ["Champ date"],
        }),
      ),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["verdict", "clarification", "translation", "components"],
    );
  });

  test("mode manuel, verdict coherent → pas de clarification", async () => {
    const request: AnalysisRequest = {
      ticketSource: "manual",
      ticketText: "Ajouter un champ date.",
      comparisonWindow: "7d",
    };
    const events = await runAnalysis(
      request,
      depsWith(
        JSON.stringify({
          verdict: "coherent",
          translation: "T",
          questions: [],
          needs: [],
        }),
      ),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["verdict", "translation", "components"],
    );
  });

  test("étage composants : figmaConnected et recommandation relayés", async () => {
    const request: AnalysisRequest = {
      ticketSource: "manual",
      ticketText: "Ajouter un champ date.",
      comparisonWindow: "7d",
    };
    const deps: AnalysisDependencies = {
      complete: async () =>
        JSON.stringify({
          verdict: "coherent",
          translation: "T",
          questions: [],
          needs: ["Champ date"],
        }),
      fetchTicket: async () => ({ key: null, title: "", body: "", updatedAt: null }),
      searchComponents: async () => ({
        status: "success",
        figmaConnected: true,
        components: [{ name: "Input", status: "reusable", figmaUrl: "https://www.figma.com/file/F1?node-id=1:2" }],
      }),
    };
    const events = await runAnalysis(request, deps);
    const last = events[events.length - 1];
    assert.deepEqual(last, {
      type: "components",
      figmaConnected: true,
      components: [{ name: "Input", status: "reusable", figmaUrl: "https://www.figma.com/file/F1?node-id=1:2" }],
    });
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
