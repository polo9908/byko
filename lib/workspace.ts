/**
 * FRONT-7/FRONT-8 — logique pure de l'espace de travail et du curseur de comparaison.
 *
 * Données d'affichage partagées (libellés des 5 paliers, noms de coût, couleurs de
 * priorité), hors DOM : testables sous node:test et sans duplication entre l'écran
 * Espace de travail (FRONT-7) et le curseur/comptage (FRONT-8).
 */

import type { ComparisonWindow, CostLevel } from "./types/analysis";

export interface WindowOption {
  value: ComparisonWindow;
  label: string;
}

/** Les 5 paliers, dans l'ordre produit (règle ligne 10 : jamais de valeur continue). */
export const WINDOW_OPTIONS: readonly WindowOption[] = [
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
  { value: "90d", label: "90 jours" },
  { value: "6m", label: "6 mois" },
  { value: "12m", label: "12 mois" },
];

/** Palier par défaut du curseur (aucun défaut n'est énoncé par les fiches : 30 jours retenu). */
export const DEFAULT_COMPARISON_WINDOW: ComparisonWindow = "30d";

/** Libellés des niveaux de coût du badge « N tickets · Coût X » (FRONT-8). */
export const COST_LEVEL_LABELS: Record<CostLevel, string> = {
  low: "Faible",
  medium: "Modéré",
  high: "Élevé",
};

/** Libellé du badge de comptage. */
export function formatScopeCount(count: number, costLevel: CostLevel): string {
  return `${count} ${count > 1 ? "tickets" : "ticket"} · Coût ${COST_LEVEL_LABELS[costLevel]}`;
}

/**
 * Couleur du fanion de priorité (FRONT-7). Les noms sont ceux que Jira sert ; une priorité
 * inconnue reçoit une teinte neutre — jamais de crash ni de texte inventé.
 */
export const PRIORITY_FLAG_COLORS: Record<string, string> = {
  Highest: "#d64541",
  High: "#e8853a",
  Medium: "#dfae1e",
  Low: "#7a9e7e",
  Lowest: "#9aa0a6",
};

const NEUTRAL_FLAG = "#c9b79c";

export function priorityFlagColor(priorityName: string): string {
  return PRIORITY_FLAG_COLORS[priorityName] ?? NEUTRAL_FLAG;
}
