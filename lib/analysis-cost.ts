/**
 * BACK-6 — Niveau qualitatif de coût d'un périmètre de comparaison.
 *
 * Conversion pure du « comptage réel » de tickets (`count` de
 * `GET /api/analysis/scope-count`) en l'un des trois niveaux du badge « N tickets · Coût X »
 * (FRONT-8) : `low` = Faible, `medium` = Modéré, `high` = Élevé.
 *
 * ───── SOURCE UNIQUE DES SEUILS ─────
 * Critère d'acceptation BACK-6 (`docs/tickets/phase-2-analyse-ticket.md`, ligne 100) : « les
 * seuils Faible/Modéré/Élevé sont centralisés dans une seule constante », jamais en dur à
 * plusieurs endroits. La constante exportée `COST_LEVEL_TIERS` EST cette source unique : ni la
 * route `scope-count`, ni le front, ni un autre module ne redéclarent de seuil. Le contrat
 * (`lib/types/analysis.ts`) ne fournit que le vocabulaire des trois niveaux — pas les seuils,
 * voir l'en-tête de son type `CostLevel`.
 *
 * Valeur actuelle (proposition de départ du ticket, ligne 94 — « à définir avec l'équipe ») :
 *   count < 10      → `low`     (Faible)
 *   10 ≤ count ≤ 30 → `medium`  (Modéré)
 *   count > 30      → `high`    (Élevé)
 * Encodée par des bornes HAUTES INCLUSES successives (9 puis 30), le dernier palier étant
 * sans borne (`Infinity`) : ajuster les seuils = modifier les bornes de cette seule
 * constante, rien d'autre. La borne de `low` valant 9 encode exactement « < 10 » pour un
 * compte entier ; la borne de `medium` valant 30 encode « 10–30 » borne haute comprise.
 *
 * Module sans import runtime (un seul `import type`, effacé à la compilation) : pur, testable
 * sans serveur HTTP ni coffre. Domaine d'entrée : un compte de clés renvoyé par le resolver
 * de BACK-5 (`ticketKeys.length`), donc un entier ≥ 0 — la fonction reste totale hors
 * domaine, voir la note de `costLevelForCount`.
 */

import type { CostLevel } from "@/lib/types/analysis";

/**
 * Un palier de la constante : le plus grand compte (borne haute INCLUSE) rattaché à un
 * niveau. Les paliers sont ordonnés par bornes strictement croissantes ; le dernier porte
 * `Infinity` — « tout compte plus grand que la borne précédente ».
 */
export interface CostLevelTier {
  readonly maxCount: number;
  readonly level: CostLevel;
}

/**
 * LA constante unique des seuils Faible/Modéré/Élevé (voir en-tête). Invariants, vérifiés par
 * `test/analysis-cost.test.ts` :
 * - les niveaux se suivent dans l'ordre produit `low` → `medium` → `high` ;
 * - les bornes hautes sont strictement croissantes, entières, et la première couvre 0 ;
 * - le dernier palier est sans borne (`Infinity`).
 */
export const COST_LEVEL_TIERS: readonly CostLevelTier[] = [
  { level: "low", maxCount: 9 },
  { level: "medium", maxCount: 30 },
  { level: "high", maxCount: Infinity },
];

/**
 * Convertit un compte de tickets en niveau qualitatif, par lecture de `COST_LEVEL_TIERS` —
 * la fonction ne connaît aucun seuil en propre, elle ne fait que parcourir la constante dans
 * l'ordre (borne haute INCLUSE : `count <= tier.maxCount` → ce palier).
 *
 * Hors domaine (compte négatif, `NaN`) la fonction reste totale : un compte négatif tombe
 * dans le premier palier (moins de tickets = coût moindre), et une valeur qui ne matche
 * aucun palier (`NaN`) retombe sur le dernier — le palier sans borne. Ces entrées sont
 * inatteignables par la route (le count est une longueur de tableau), la totalité n'est là
 * que pour qu'un appel aberrant ne puisse pas produire `undefined`.
 */
export function costLevelForCount(count: number): CostLevel {
  for (const tier of COST_LEVEL_TIERS) {
    if (count <= tier.maxCount) {
      return tier.level;
    }
  }
  return COST_LEVEL_TIERS[COST_LEVEL_TIERS.length - 1].level;
}
