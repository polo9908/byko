/**
 * BACK-4 — `lib/settings-request.ts` : validation à la frontière de `POST /api/settings`.
 * Un refus ici doit rester un `4xx` (requête malformée), jamais l'enveloppe `status: "error"`
 * réservée aux verdicts applicatifs — ce fichier vérifie seulement la fonction de validation,
 * le choix du code HTTP est vérifié séparément sur la route.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseSaveSettingsRequest } from "@/lib/settings-request";

describe("parseSaveSettingsRequest — corps malformés", () => {
  test("corps vide (undefined) -> refusé", () => {
    const result = parseSaveSettingsRequest(undefined);
    assert.equal(result.ok, false);
  });

  test("corps qui n'est pas un objet (tableau) -> refusé", () => {
    const result = parseSaveSettingsRequest([1, 2, 3]);
    assert.equal(result.ok, false);
  });

  test("block absent -> refusé", () => {
    const result = parseSaveSettingsRequest({ credentials: { apiToken: "x" } });
    assert.equal(result.ok, false);
  });

  test("block inconnu -> refusé", () => {
    const result = parseSaveSettingsRequest({ block: "confluence", credentials: {} });
    assert.equal(result.ok, false);
  });

  test('{"block":"jira"} sans credentials -> refusé', () => {
    const result = parseSaveSettingsRequest({ block: "jira" });
    assert.equal(result.ok, false);
  });

  test("jira avec un champ manquant (email) -> refusé", () => {
    const result = parseSaveSettingsRequest({
      block: "jira",
      credentials: { instanceUrl: "https://x.atlassian.net", apiToken: "t" },
    });
    assert.equal(result.ok, false);
  });

  test("jira avec des chaînes vides -> refusé (pas de valeur par défaut fabriquée)", () => {
    const result = parseSaveSettingsRequest({
      block: "jira",
      credentials: { instanceUrl: "", email: "", apiToken: "" },
    });
    assert.equal(result.ok, false);
  });

  test("ai avec un provider hors liste fermée -> refusé", () => {
    const result = parseSaveSettingsRequest({
      block: "ai",
      credentials: { provider: "chatgpt-4", apiToken: "t" },
    });
    assert.equal(result.ok, false);
  });

  test("figma sans credentials ni skipped -> refusé", () => {
    const result = parseSaveSettingsRequest({ block: "figma" });
    assert.equal(result.ok, false);
  });

  test("figma avec skipped: false -> refusé (sens indéterminé, pas assimilé à not_connected)", () => {
    const result = parseSaveSettingsRequest({ block: "figma", skipped: false });
    assert.equal(result.ok, false);
  });

  test("onboarding sans le champ -> refusé", () => {
    const result = parseSaveSettingsRequest({ block: "onboarding" });
    assert.equal(result.ok, false);
  });

  test("onboarding avec onboardingCompleted: false -> refusé (transition à sens unique)", () => {
    const result = parseSaveSettingsRequest({ block: "onboarding", onboardingCompleted: false });
    assert.equal(result.ok, false);
  });
});

describe("parseSaveSettingsRequest — corps valides", () => {
  test("jira complet -> accepté, valeurs reprises telles quelles", () => {
    const result = parseSaveSettingsRequest({
      block: "jira",
      credentials: {
        instanceUrl: "https://exemple.atlassian.net",
        email: "a@b.com",
        apiToken: "jeton",
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      block: "jira",
      credentials: {
        instanceUrl: "https://exemple.atlassian.net",
        email: "a@b.com",
        apiToken: "jeton",
      },
    });
  });

  test("figma { skipped: true } -> accepté, distinct d'un envoi de credentials", () => {
    const result = parseSaveSettingsRequest({ block: "figma", skipped: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { block: "figma", skipped: true });
  });

  test("figma avec credentials -> accepté", () => {
    const result = parseSaveSettingsRequest({ block: "figma", credentials: { apiToken: "t" } });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { block: "figma", credentials: { apiToken: "t" } });
  });

  test("ai avec un provider de la liste fermée -> accepté", () => {
    const result = parseSaveSettingsRequest({
      block: "ai",
      credentials: { provider: "gemini", apiToken: "t" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      block: "ai",
      credentials: { provider: "gemini", apiToken: "t" },
    });
  });

  test("onboarding { onboardingCompleted: true } -> accepté", () => {
    const result = parseSaveSettingsRequest({ block: "onboarding", onboardingCompleted: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, { block: "onboarding", onboardingCompleted: true });
  });
});
