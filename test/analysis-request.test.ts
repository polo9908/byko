/**
 * BACK-7 — frontière de `POST /api/analysis` (`lib/analysis-request.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseAnalysisRequest } from "@/lib/analysis-request";

describe("parseAnalysisRequest", () => {
  test("corps non objet → erreur", () => {
    assert.equal(parseAnalysisRequest(null).ok, false);
    assert.equal(parseAnalysisRequest("x").ok, false);
  });

  test("ticketSource inconnu → erreur", () => {
    const result = parseAnalysisRequest({ ticketSource: "autre", comparisonWindow: "7d" });
    assert.equal(result.ok, false);
  });

  test("comparisonWindow absent ou hors paliers → erreur", () => {
    assert.equal(parseAnalysisRequest({ ticketSource: "manual", ticketText: "x" }).ok, false);
    assert.equal(
      parseAnalysisRequest({ ticketSource: "manual", ticketText: "x", comparisonWindow: "3d" }).ok,
      false,
    );
  });

  test("mode jira : ticketKey requis", () => {
    const result = parseAnalysisRequest({ ticketSource: "jira", comparisonWindow: "7d" });
    assert.equal(result.ok, false);
  });

  test("mode jira valide", () => {
    const result = parseAnalysisRequest({
      ticketSource: "jira",
      ticketKey: "PROJ-1",
      comparisonWindow: "30d",
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual(result.request, {
        ticketSource: "jira",
        ticketKey: "PROJ-1",
        comparisonWindow: "30d",
        scopeHint: undefined,
      });
    }
  });

  test("mode manuel : ticketText requis", () => {
    const result = parseAnalysisRequest({ ticketSource: "manual", comparisonWindow: "7d" });
    assert.equal(result.ok, false);
  });

  test("mode manuel valide avec scopeHint", () => {
    const result = parseAnalysisRequest({
      ticketSource: "manual",
      ticketText: "un ticket",
      comparisonWindow: "12m",
      scopeHint: "Paiement",
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.request.ticketSource, "manual");
      assert.equal(result.request.scopeHint, "Paiement");
    }
  });
});
