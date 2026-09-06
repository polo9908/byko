/**
 * BACK-8 — recherche de composants Figma à partir des besoins fonctionnels.
 *
 * Consomme `lib/figma-search.ts` (MCP-3, transport injecté) et `lib/figma-link.ts` pour
 * produire les recommandations du contrat ARCHI-4 (`ComponentRecommendation`), classées en
 * 3 états selon le score renvoyé : `reusable` (score fort), `to_verify` (score partiel),
 * `to_create` (aucun résultat pertinent). Sans Figma connecté, AUCUN appel n'est tenté :
 * réponse immédiate `{ figmaConnected: false, components: [] }` (critère BACK-8, ligne 202).
 *
 * ─── SEUILS DE CLASSIFICATION (source unique, proposition à calibrer) ───
 * Le score de `search_design_system` n'a pas encore été OBSERVÉ (aucun MCP Figma dans cet
 * environnement — `docs/mcp-status.md`). Les bornes ci-dessous sont donc une PROPOSITION,
 * centralisée dans UNE constante et documentée « à calibrer au premier appel réel », exactement
 * comme les seuils de coût de BACK-6. Ne pas les répartir en dur ailleurs.
 */

import type {
  ComponentRecommendation,
  ComponentStatus,
} from "@/lib/types/analysis";
import { buildFigmaDeepLink } from "@/lib/figma-link";
import {
  searchDesignSystem,
  type FigmaSearchExecutor,
} from "@/lib/figma-search";

export interface ComponentScoreTier {
  /** Score minimal (inclus) pour ce niveau. */
  readonly minScore: number;
  readonly status: ComponentStatus;
}

/**
 * LA constante unique des seuils. Ordonnée par `minScore` décroissant, la première borne
 * franchie fait foi. Proposition de départ : ≥ 0.7 → `reusable`, ≥ 0.4 → `to_verify`,
 * sinon `to_create`. À calibrer sur des scores réels.
 */
export const COMPONENT_SCORE_TIERS: readonly ComponentScoreTier[] = [
  { status: "reusable", minScore: 0.7 },
  { status: "to_verify", minScore: 0.4 },
];

/**
 * Convertit un score en état. Un score non numérique (valeur inattendue du connecteur) est
 * traité comme « rien de pertinent » (`to_create`) : ne jamais prétendre recycler un
 * résultat qu'on ne sait pas noter.
 */
export function classifyComponentScore(score: number): ComponentStatus {
  if (Number.isNaN(score)) return "to_create";
  for (const tier of COMPONENT_SCORE_TIERS) {
    if (score >= tier.minScore) return tier.status;
  }
  return "to_create";
}

export interface ComponentSearchDependencies {
  figmaConnected: boolean;
  execute: FigmaSearchExecutor;
}

export type ComponentSearchOutcome =
  | { status: "success"; figmaConnected: boolean; components: ComponentRecommendation[] }
  | { status: "error"; message: string };

/**
 * Recherche un composant par besoin. Ne lève jamais.
 *
 * - Figma non connecté → succès immédiat, `figmaConnected: false`, liste vide, SANS appel
 *   à `execute` (critère « aucun appel MCP tenté »).
 * - Besoin sans résultat → recommandation `to_create` portant le libellé du besoin (c'est ce
 *   que FRONT-10 affichera sur la carte « À créer »), sans `figmaUrl`.
 * - Panne de l'outil (`searchDesignSystem` en erreur) → `error` PROPAGÉE, jamais convertie
 *   en `to_create` (MCP-3 : panne ≠ aucun résultat).
 */
export async function searchComponents(
  needs: readonly string[],
  deps: ComponentSearchDependencies,
): Promise<ComponentSearchOutcome> {
  if (!deps.figmaConnected || needs.length === 0) {
    return { status: "success", figmaConnected: deps.figmaConnected, components: [] };
  }

  const components: ComponentRecommendation[] = [];
  for (const need of needs) {
    const outcome = await searchDesignSystem(need, deps.execute);
    if (outcome.status === "error") {
      return { status: "error", message: outcome.message };
    }
    if (outcome.items.length === 0) {
      components.push({ name: need, status: "to_create" });
      continue;
    }
    const best = outcome.items.reduce((current, item) =>
      item.score > current.score ? item : current,
    );
    components.push({
      name: best.name,
      status: classifyComponentScore(best.score),
      figmaUrl: buildFigmaDeepLink(best.fileKey, best.nodeId),
    });
  }

  return { status: "success", figmaConnected: true, components };
}
