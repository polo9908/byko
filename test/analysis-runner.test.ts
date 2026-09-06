/**
 * BACK-7/BACK-8/BACK-10 — orchestration de l'analyse (`lib/analysis-runner.ts`).
 *
 * Couvre l'ordre des événements (mode manuel, complétion injectée), l'étage composants
 * (BACK-8, injecté), le mode Jira quand le coffre est vide (Jira non connecté → événement
 * d'erreur, sans réseau), et — avenant BACK-10 — la présence de `record` dans le résultat :
 * présent uniquement en mode Jira quand l'analyse a réussi sur un snapshot portant sa date
 * de source, absent en mode manuel, en cas d'événement `error` terminal et quand le
 * snapshot analysé n'a pas d'`updatedAt`.
 *
 * Pour faire RÉUSSIR une analyse en mode Jira (la seule façon d'observer `record`), il faut
 * que la résolution du périmètre (BACK-5) réussisse : `runAnalysis` l'appelle SANS options,
 * donc par le `fetch` GLOBAL — le test pointe `HOME` sur un répertoire temporaire, y écrit
 * un coffre Jira connecté par le vrai chemin de persistance (`getSettingsStore().write`),
 * puis stubbe `globalThis.fetch` pour répondre au GET issue du ticket (aucun lien, aucun
 * epic/component → périmètre `none`, zéro clé, une seule requête réseau).
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
import { AnalysisNotWiredError } from "@/lib/analysis-pipeline";
import type { AnalysisRequest } from "@/lib/types/analysis";
import { createSecret } from "@/lib/secret";
import { getSettingsStore, SETTINGS_SCHEMA_VERSION } from "@/lib/settings-store";
import type { PersistedSettingsDocument } from "@/lib/settings-store";
import { withStubbedFetch } from "./helpers/stub-fetch";

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

const COHERENT_RAW = JSON.stringify({
  verdict: "coherent",
  translation: "Le ticket ajoute un champ date.",
  questions: [],
  needs: ["Champ date"],
});

describe("runAnalysis", () => {
  test("mode manuel, verdict ambigu → ordre verdict/clarification/traduction/components, sans enregistrement", async () => {
    const request: AnalysisRequest = {
      ticketSource: "manual",
      ticketText: "Ajouter un champ date.",
      comparisonWindow: "7d",
    };
    const outcome = await runAnalysis(
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
      outcome.events.map((event) => event.type),
      ["verdict", "clarification", "translation", "components"],
    );
    // Mode manuel : jamais d'enregistrement (BACK-9/BACK-10 concernent les tickets Jira).
    assert.equal(outcome.record, undefined);
  });

  test("mode manuel, verdict coherent → pas de clarification, sans enregistrement", async () => {
    const request: AnalysisRequest = {
      ticketSource: "manual",
      ticketText: "Ajouter un champ date.",
      comparisonWindow: "7d",
    };
    const outcome = await runAnalysis(request, depsWith(COHERENT_RAW));
    assert.deepEqual(
      outcome.events.map((event) => event.type),
      ["verdict", "translation", "components"],
    );
    assert.equal(outcome.record, undefined);
  });

  test("étage composants : figmaConnected et recommandation relayés", async () => {
    const request: AnalysisRequest = {
      ticketSource: "manual",
      ticketText: "Ajouter un champ date.",
      comparisonWindow: "7d",
    };
    const deps: AnalysisDependencies = {
      complete: async () => COHERENT_RAW,
      fetchTicket: async () => ({ key: null, title: "", body: "", updatedAt: null }),
      searchComponents: async () => ({
        status: "success",
        figmaConnected: true,
        components: [{ name: "Input", status: "reusable", figmaUrl: "https://www.figma.com/file/F1?node-id=1:2" }],
      }),
    };
    const outcome = await runAnalysis(request, deps);
    const last = outcome.events[outcome.events.length - 1];
    assert.deepEqual(last, {
      type: "components",
      figmaConnected: true,
      components: [{ name: "Input", status: "reusable", figmaUrl: "https://www.figma.com/file/F1?node-id=1:2" }],
    });
  });

  test("mode Jira sans coffre (Jira non connecté) → un seul événement d'erreur, sans réseau, sans enregistrement", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "byko-runner-"));
    process.env.HOME = tempHome;
    try {
      const outcome = await runAnalysis({
        ticketSource: "jira",
        ticketKey: "PROJ-1",
        comparisonWindow: "7d",
      });
      assert.equal(outcome.events.length, 1);
      assert.equal(outcome.events[0].type, "error");
      assert.equal(outcome.record, undefined);
    } finally {
      process.env.HOME = originalHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Mode Jira qui RÉUSSIT — observation de l'enregistrement (avenant BACK-10)  */
/* -------------------------------------------------------------------------- */

const INSTANCE_URL = "https://mon-entreprise.atlassian.net";

function connectedDocument(): PersistedSettingsDocument {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    jira: {
      status: "connected",
      instanceUrl: INSTANCE_URL,
      email: "jane@exemple.com",
      apiToken: createSecret("ATATT3xFf-jeton-scope-suffisamment-long-0001"),
      account: { accountName: "Jane Doe" },
    },
    figma: { status: "not_connected" },
    ai: { status: "not_connected" },
    onboardingCompleted: true,
  };
}

/**
 * Exécute `run` avec `HOME` pointé sur un répertoire temporaire (coffres isolés du vrai
 * `~/.bcc`), Jira connecté écrit par le chemin réel, et le `fetch` global stubbe pour
 * répondre au GET issue du périmètre (ticket sans lien ni epic/component → périmètre
 * `none`, zéro clé, aucune recherche JQL).
 */
async function withJiraScopeSuccess(run: () => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "byko-runner-jira-"));
  process.env.HOME = tempHome;
  try {
    const settings = getSettingsStore();
    const written = await settings.write(connectedDocument());
    assert.equal(written.status, "written");

    let networkCalls = 0;
    await withStubbedFetch(async () => {
      networkCalls += 1;
      // Réponse du GET issue : aucun lien, aucun parent, aucun composant → la résolution
      // répond `none` SANS émettre de recherche (BACK-5, en-tête §7/§8).
      return new Response(
        JSON.stringify({
          key: "PROJ-1",
          fields: { issuelinks: [], parent: null, components: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }, run);
    // Une seule requête réseau : le GET issue du ticket cible. Aucune recherche, aucun
    // autre appel — sinon le scénario ne teste pas ce qu'il prétend.
    assert.equal(networkCalls, 1);
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

describe("runAnalysis — mode Jira réussi : enregistrement d'historique (BACK-10)", () => {
  test("analyse réussie avec date de source → record présent, événements sans error", async () => {
    await withJiraScopeSuccess(async () => {
      const request: AnalysisRequest = {
        ticketSource: "jira",
        ticketKey: "PROJ-1",
        comparisonWindow: "7d",
      };
      const deps: AnalysisDependencies = {
        complete: async () => COHERENT_RAW,
        fetchTicket: async () => ({
          key: "PROJ-1",
          title: "Champ date",
          body: "Ajouter un champ date.",
          updatedAt: "2026-09-05T10:00:00.000Z",
        }),
        searchComponents: noComponents,
      };
      const outcome = await runAnalysis(request, deps);

      assert.deepEqual(
        outcome.events.map((event) => event.type),
        ["verdict", "translation", "components"],
      );
      assert.notEqual(outcome.record, undefined);
      if (outcome.record === undefined) return;
      assert.equal(outcome.record.ticketKey, "PROJ-1");
      assert.equal(outcome.record.verdict, "coherent");
      assert.equal(outcome.record.clarification, null);
      assert.equal(outcome.record.translation, "Le ticket ajoute un champ date.");
      assert.equal(outcome.record.updatedAt, "2026-09-05T10:00:00.000Z");
      assert.equal(outcome.record.comparisonWindow, "7d");
      assert.equal(Number.isNaN(Date.parse(outcome.record.analyzedAt)), false);
      assert.match(outcome.record.sourceHash, /^[0-9a-f]{64}$/);
    });
  });

  test("clé de ticket normalisée (trim) dans l'enregistrement", async () => {
    await withJiraScopeSuccess(async () => {
      const request: AnalysisRequest = {
        ticketSource: "jira",
        ticketKey: "  PROJ-1  ",
        comparisonWindow: "30d",
      };
      const deps: AnalysisDependencies = {
        complete: async () => COHERENT_RAW,
        fetchTicket: async () => ({
          key: "PROJ-1",
          title: "Champ date",
          body: "Ajouter un champ date.",
          updatedAt: "2026-09-05T10:00:00.000Z",
        }),
        searchComponents: noComponents,
      };
      const outcome = await runAnalysis(request, deps);
      assert.notEqual(outcome.record, undefined);
      if (outcome.record === undefined) return;
      assert.equal(outcome.record.ticketKey, "PROJ-1");
      assert.equal(outcome.record.comparisonWindow, "30d");
    });
  });

  test("snapshot sans date de source (ticket introuvable) → analyse réussie mais AUCUN enregistrement", async () => {
    await withJiraScopeSuccess(async () => {
      const request: AnalysisRequest = {
        ticketSource: "jira",
        ticketKey: "PROJ-1",
        comparisonWindow: "7d",
      };
      const deps: AnalysisDependencies = {
        complete: async () => COHERENT_RAW,
        // Le récupérateur ne trouve pas le ticket : le runner replie sur un snapshot vide
        // SANS `updatedAt` (comportement BACK-7 existant) — la fraîcheur de ce résultat
        // serait indécidable, donc rien n'est enregistré (décision BACK-10 n°3).
        fetchTicket: async () => null,
        searchComponents: noComponents,
      };
      const outcome = await runAnalysis(request, deps);
      assert.equal(outcome.events.some((event) => event.type === "error"), false);
      assert.equal(outcome.record, undefined);
    });
  });

  test("échec de l'étage composants (BACK-8) → événement error terminal et AUCUN enregistrement", async () => {
    await withJiraScopeSuccess(async () => {
      const request: AnalysisRequest = {
        ticketSource: "jira",
        ticketKey: "PROJ-1",
        comparisonWindow: "7d",
      };
      const deps: AnalysisDependencies = {
        complete: async () => COHERENT_RAW,
        fetchTicket: async () => ({
          key: "PROJ-1",
          title: "Champ date",
          body: "Ajouter un champ date.",
          updatedAt: "2026-09-05T10:00:00.000Z",
        }),
        searchComponents: async () => {
          throw new AnalysisNotWiredError();
        },
      };
      const outcome = await runAnalysis(request, deps);
      assert.equal(outcome.events[outcome.events.length - 1].type, "error");
      // Un flux incomplet (étage composants en échec) n'est pas un résultat complet : rien
      // n'est enregistré — l'enregistrement n'a lieu que sans aucun événement error.
      assert.equal(outcome.record, undefined);
    });
  });

  test("réponse du modèle illisible → événement error unique et AUCUN enregistrement", async () => {
    await withJiraScopeSuccess(async () => {
      const request: AnalysisRequest = {
        ticketSource: "jira",
        ticketKey: "PROJ-1",
        comparisonWindow: "7d",
      };
      const deps: AnalysisDependencies = {
        complete: async () => "pas un json",
        fetchTicket: async () => ({
          key: "PROJ-1",
          title: "Champ date",
          body: "Ajouter un champ date.",
          updatedAt: "2026-09-05T10:00:00.000Z",
        }),
        searchComponents: noComponents,
      };
      const outcome = await runAnalysis(request, deps);
      assert.equal(outcome.events.length, 1);
      assert.equal(outcome.events[0].type, "error");
      assert.equal(outcome.record, undefined);
    });
  });
});
