/**
 * BACK-10 (fin) — liste de tickets Jira (`lib/jira-tickets.ts`).
 *
 * La normalisation (flag + ordre conservé) est pure ; l'appel réseau est exercé avec un
 * fetch mocké ; l'historique étant lu dans le coffre, les tests réseau isolent HOME.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildTicketListQuery,
  fetchTicketList,
  normalizeTicketList,
} from "@/lib/jira-tickets";
import type { JiraApiAccess } from "@/lib/jira-scope";

const ACCESS: JiraApiAccess = {
  apiBase: "https://acme.atlassian.net",
  authorization: "Basic ZmFrZTpmYWtl",
};

describe("normalizeTicketList", () => {
  test("injecte alreadyAnalyzed sans changer l'ordre, pour les clés présentes dans l'historique", () => {
    const issues = [
      { key: "P-1", fields: { summary: "Un", priority: { name: "Highest", iconUrl: "https://i/p1.png" }, updated: "2026-09-01T00:00:00.000Z" } },
      { key: "P-2", fields: { summary: "Deux", priority: { name: "Low" }, updated: "2026-09-02T00:00:00.000Z" } },
    ];
    const items = normalizeTicketList(issues, ["P-2"]);
    assert.deepEqual(
      items.map((t) => [t.key, t.alreadyAnalyzed]),
      [["P-1", false], ["P-2", true]],
    );
    assert.equal(items[0].priorityIconUrl, "https://i/p1.png");
    assert.equal(items[1].priorityIconUrl, undefined);
  });

  test("champs absents tolérés (jamais de valeur inventée), entrée sans clé ignorée", () => {
    const issues = [
      { fields: {} },
      { key: "P-3", fields: { summary: null, priority: null, updated: null } },
    ];
    const items = normalizeTicketList(issues, []);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      key: "P-3",
      summary: "",
      priorityName: "",
      updatedAt: null,
      alreadyAnalyzed: false,
    });
  });

  test("requête JQL : tri serveur par priorité puis mise à jour", () => {
    const query = buildTicketListQuery(50);
    assert.match(decodeURIComponent(query), /ORDER BY priority DESC, updated DESC/);
    assert.match(query, /maxResults=50/);
  });
});

describe("fetchTicketList", () => {
  test("fetch mocké → liste normalisée (historique absent dans un HOME temporaire)", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "byko-tickets-"));
    process.env.HOME = tempHome;
    try {
      const outcome = await fetchTicketList(ACCESS, {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              issues: [
                { key: "P-1", fields: { summary: "Un", priority: { name: "Highest" }, updated: "2026-09-01T00:00:00.000Z" } },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      });
      assert.equal(outcome.status, "success");
      if (outcome.status === "success") {
        assert.equal(outcome.tickets.length, 1);
        assert.equal(outcome.tickets[0].key, "P-1");
        assert.equal(outcome.tickets[0].alreadyAnalyzed, false);
      }
    } finally {
      process.env.HOME = originalHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test("Jira refuse (HTTP 500) → erreur précise", async () => {
    const outcome = await fetchTicketList(ACCESS, {
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });
    assert.equal(outcome.status, "error");
  });
});
