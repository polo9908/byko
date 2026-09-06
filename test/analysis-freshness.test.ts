/**
 * BACK-9 — pureté et bornes de `lib/analysis-freshness.ts` : la fonction d'évaluation de la
 * fraîcheur ne fait aucune E/S, aucune lecture d'horloge, aucune dépendance — mêmes entrées,
 * mêmes sorties. Couvre les trois états et les quatre façons de ne pas pouvoir décider.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { assessFreshness } from "@/lib/analysis-freshness";

const SNAPSHOT_DATE = "2026-09-05T10:00:00.000Z";
const LATER_DATE = "2026-09-06T10:00:00.000Z";
const EARLIER_DATE = "2026-09-04T10:00:00.000Z";

describe("assessFreshness — fonction pure", () => {
  test("mêmes entrées → mêmes sorties (répétable à l'identique)", () => {
    assert.deepEqual(assessFreshness(SNAPSHOT_DATE, SNAPSHOT_DATE), { status: "fresh" });
    assert.deepEqual(assessFreshness(SNAPSHOT_DATE, SNAPSHOT_DATE), { status: "fresh" });
  });

  test("date courante identique au snapshot → fresh (rien n'a changé depuis l'analyse)", () => {
    assert.deepEqual(assessFreshness(SNAPSHOT_DATE, SNAPSHOT_DATE), { status: "fresh" });
  });

  test("date courante ANTÉRIEURE au snapshot → fresh (aucune modification postérieure)", () => {
    assert.deepEqual(assessFreshness(SNAPSHOT_DATE, EARLIER_DATE), { status: "fresh" });
  });

  test("date courante postérieure au snapshot → stale, staleSince = date de modification courante", () => {
    const outcome = assessFreshness(SNAPSHOT_DATE, LATER_DATE);
    assert.deepEqual(outcome, { status: "stale", staleSince: LATER_DATE });
  });

  test("date de source de l'analyse absente (null) → unknown, jamais « fresh » par défaut", () => {
    const outcome = assessFreshness(null, LATER_DATE);
    assert.equal(outcome.status, "unknown");
    if (outcome.status === "unknown") {
      assert.equal(outcome.reason.length > 0, true);
    }
  });

  test("état courant absent (null) → unknown, jamais « fresh » par défaut", () => {
    const outcome = assessFreshness(SNAPSHOT_DATE, null);
    assert.equal(outcome.status, "unknown");
    if (outcome.status === "unknown") {
      assert.equal(outcome.reason.length > 0, true);
    }
  });

  test("date illisible (source ou courante) → unknown, avec sa raison — rien n'est affirmé", () => {
    for (const [analyzed, current] of [
      ["pas-une-date", SNAPSHOT_DATE],
      [SNAPSHOT_DATE, "pas-une-date"],
      ["", LATER_DATE],
      [SNAPSHOT_DATE, ""],
    ] as const) {
      const outcome = assessFreshness(analyzed, current);
      assert.equal(outcome.status, "unknown", `dates ${analyzed} / ${current} non refusées`);
      if (outcome.status === "unknown") {
        assert.equal(outcome.reason.length > 0, true);
      }
    }
  });

  test("les raisons ne recopient aucune donnée du ticket", () => {
    const outcome = assessFreshness(null, null);
    assert.equal(outcome.status, "unknown");
    if (outcome.status === "unknown") {
      assert.equal(outcome.reason.includes(SNAPSHOT_DATE), false);
      assert.equal(outcome.reason.includes("2026"), false);
    }
  });
});
