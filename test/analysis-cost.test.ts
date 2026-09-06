/**
 * BACK-6 — Surface pure de `lib/analysis-cost.ts` : la constante unique des seuils
 * Faible/Modéré/Élevé et la fonction `costLevelForCount`.
 *
 * Aucun serveur HTTP, aucun coffre : le module n'a pas d'import runtime, la suite se
 * contente de l'importer et de l'exercer.
 *
 * « Le test importe la constante, pas une valeur recopiée » : aucune assertion de ce fichier
 * ne redéclare une table de seuils parallèle. Les valeurs limites sont des SONDES (les
 * comptes que le ticket nomme : 0, 9, 10, 29, 30, 31, 10 000) dont l'attendu est lu DANS la
 * constante (`tier.level`) — si l'équipe ajuste les bornes (la proposition « <10 / 10–30 /
 * >30 » est « à définir avec l'équipe », ligne 94 du ticket), la structure reste vérifiée et
 * les sondes qui ne correspondent plus au nouvel accord échouent bruyamment, forçant à
 * revalider la règle plutôt que de la laisser dériver en silence.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { COST_LEVEL_TIERS, costLevelForCount } from "@/lib/analysis-cost";
import type { CostLevel } from "@/lib/types/analysis";

describe("BACK-6 — lib/analysis-cost : paliers centralisés", () => {
  test("la constante est bien formée : low → medium → high, bornes croissantes, dernier sans borne", () => {
    // Ordre produit : Faible, Modéré, Élevé — l'ordre de la liste EST l'ordre des niveaux.
    const expectedLevels: readonly CostLevel[] = ["low", "medium", "high"];
    assert.deepEqual(COST_LEVEL_TIERS.map((tier) => tier.level), expectedLevels);

    // Une seule constante : si un second tableau de seuils apparaissait ailleurs, ce test
    // n'aurait aucun moyen de le voir — c'est la route de lint/relecture qui le traquerait ;
    // ici on verrouille la FORME de l'unique source.
    assert.equal(COST_LEVEL_TIERS.length, expectedLevels.length);

    // Bornes hautes strictement croissantes (un chevauchement rendrait l'ordre ambigu) et
    // entières hors dernier palier (un compte est entier).
    for (let i = 0; i < COST_LEVEL_TIERS.length - 1; i += 1) {
      const current = COST_LEVEL_TIERS[i];
      const next = COST_LEVEL_TIERS[i + 1];
      assert.equal(Number.isInteger(current.maxCount), true, `borne ${current.level} non entière`);
      assert.equal(current.maxCount < next.maxCount, true, `bornes ${current.level}/${next.level} non croissantes`);
    }

    // Le premier palier couvre 0 (« aucun ticket » doit toujours être Faible)…
    assert.equal(COST_LEVEL_TIERS[0].maxCount >= 0, true);
    // … et le dernier est sans borne : tout compte supérieur à la borne précédente a un niveau.
    assert.equal(COST_LEVEL_TIERS[COST_LEVEL_TIERS.length - 1].maxCount, Number.POSITIVE_INFINITY);
  });

  test("bornes exactes : les comptes 0, 9, 10, 29, 30, 31, 10 000 suivent la règle du ticket", () => {
    const low = COST_LEVEL_TIERS[0].level; // Faible, attendu pour < 10
    const medium = COST_LEVEL_TIERS[1].level; // Modéré, attendu pour 10–30
    const high = COST_LEVEL_TIERS[2].level; // Élevé, attendu pour > 30

    // 0 : aucun ticket — Faible (borne nulle).
    assert.equal(costLevelForCount(0), low);
    // 9 : dernière valeur de Faible (règle « < 10 »).
    assert.equal(costLevelForCount(9), low);
    // 10 : première valeur de Modéré (borne basse INCLUSE).
    assert.equal(costLevelForCount(10), medium);
    // 29 : intérieur de Modéré.
    assert.equal(costLevelForCount(29), medium);
    // 30 : borne haute de Modéré INCLUSE (règle « 10–30 » — > 30 seulement passe à Élevé).
    assert.equal(costLevelForCount(30), medium);
    // 31 : première valeur d'Élevé (règle « > 30 »).
    assert.equal(costLevelForCount(31), high);
    // 10 000 : très grand périmètre, toujours Élevé.
    assert.equal(costLevelForCount(10_000), high);
  });

  test("la fonction suit la constante sur toutes ses bornes (borne incluse, borne + 1 au palier suivant)", () => {
    for (let i = 0; i < COST_LEVEL_TIERS.length; i += 1) {
      const tier = COST_LEVEL_TIERS[i];
      // Borne haute INCLUSE : le compte maxCount appartient au palier.
      assert.equal(costLevelForCount(tier.maxCount), tier.level, `borne ${tier.level} non incluse`);
      // Borne + 1 : si le palier suivant existe (bornes finies), le compte bascule dessus.
      if (Number.isFinite(tier.maxCount)) {
        const next = COST_LEVEL_TIERS[i + 1];
        assert.equal(costLevelForCount(tier.maxCount + 1), next.level, `bascule ${tier.level} → ${next.level} ratée`);
      }
    }
  });
});
