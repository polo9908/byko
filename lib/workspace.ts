/**
 * FRONT-7/FRONT-8/FRONT-9/FRONT-10 — logique pure de l'espace de travail, du curseur de
 * comparaison, du verdict et de la section composants.
 *
 * Données d'affichage partagées (libellés des 5 paliers, noms de coût, couleurs de
 * priorité, états de composant), hors DOM : testables sous node:test et sans duplication
 * entre les écrans.
 */

import type {
  ComparisonWindow,
  ComponentStatus,
  CostLevel,
  Verdict,
} from "./types/analysis";

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

/* -------------------------------------------------------------------------- */
/* Verdict (FRONT-9)                                                          */
/* -------------------------------------------------------------------------- */

/** Libellés des 3 verdicts (badge + titre). */
export const VERDICT_LABELS: Record<Verdict, string> = {
  coherent: "Cohérent",
  minor_reservations: "Réserves mineures",
  breaking_risk: "Cassure risquée",
};

/** Détail de l'infobulle « ? » (survol), par verdict. */
export const VERDICT_HINTS: Record<Verdict, string> = {
  coherent:
    "Le ticket est cohérent avec son historique : vous pouvez le démarrer en confiance.",
  minor_reservations:
    "Des points demandent une clarification avant de démarrer. Les questions à poser sont affichées ci-dessous.",
  breaking_risk:
    "Des contradictions avec l'historique rendent le démarrage risqué. Lisez la traduction et les questions avant de continuer.",
};

export interface VerdictTheme {
  color: string;
  background: string;
}

/** Couleurs de badge par verdict (3 couleurs distinctes au premier coup d'œil). */
export const VERDICT_THEMES: Record<Verdict, VerdictTheme> = {
  coherent: { color: "#2f6b3a", background: "#e4efe1" },
  minor_reservations: { color: "#8a6d1a", background: "#f6ecce" },
  breaking_risk: { color: "#a12f22", background: "#f6deda" },
};

/* -------------------------------------------------------------------------- */
/* Composants (FRONT-10)                                                       */
/* -------------------------------------------------------------------------- */

/** Libellés des 3 états d'un composant (badge de carte, BACK-8). */
export const COMPONENT_STATUS_LABELS: Record<ComponentStatus, string> = {
  reusable: "Recyclable",
  to_verify: "À vérifier",
  to_create: "À créer",
};

export interface ComponentStatusTheme {
  color: string;
  background: string;
}

/**
 * Couleurs de badge par état composant (3 teintes distinctes au premier coup d'œil).
 *
 * Mêmes familles que les verdicts pour la lecture : vert = recyclable (bonne nouvelle),
 * ambre = à vérifier (attention). « À créer » n'est PAS une erreur (contrairement à
 * « Cassure risquée ») : il reçoit une teinte neutre chaude, pas le rouge.
 */
export const COMPONENT_STATUS_THEMES: Record<ComponentStatus, ComponentStatusTheme> = {
  reusable: { color: "#2f6b3a", background: "#e4efe1" },
  to_verify: { color: "#8a6d1a", background: "#f6ecce" },
  to_create: { color: "#5b5347", background: "#e9e4da" },
};

/**
 * Marque décorative de la zone d'aperçu d'une carte composant (FRONT-10). Le contrat
 * BACK-8 ne porte AUCUNE image (pas de miniature Figma, MCP-3 = deep-link pur) : l'aperçu
 * est réalisé avec les seules données disponibles — ici la première lettre du nom, rendue
 * grande sur la teinte de l'état. Dérivée du nom (donnée réelle), jamais inventée. Une
 * chaîne vide reçoit « ? » — le nom externe peut être vide à la frontière, pas de crash.
 */
export function componentInitials(name: string): string {
  const first = Array.from(name.trim())[0];
  return first === undefined ? "?" : first.toUpperCase();
}

/**
 * Messages d'état de la section composants (FRONT-10) — trois états distincts, jamais
 * confondus visuellement ni dans le libellé :
 * - Figma non connecté (BACK-8) : l'incitation du ticket, avec lien Paramètres ;
 * - périmètre « none » (BACK-5) : message dédié plutôt qu'une grille vide silencieuse ;
 * - aucun composant proposé : état vide honnête quand la recherche a pu avoir lieu.
 */
export const COMPONENTS_FIGMA_MESSAGE =
  "Connecte Figma pour voir les composants recommandés.";
export const COMPONENTS_NO_SCOPE_MESSAGE =
  "Aucun composant proposé : le champ « Epic / composant » est vide, aucune comparaison possible pour ce ticket.";
export const COMPONENTS_EMPTY_MESSAGE = "Aucun composant proposé pour ce ticket.";

export type ComponentsSectionKind =
  | { kind: "cards" }
  | { kind: "figma_disconnected" }
  | { kind: "scope_none" }
  | { kind: "no_components" };

/**
 * FRONT-10 — état d'affichage de la section composants, décidé SANS rendu (testable).
 *
 * Priorité assumée : Figma non connecté passe AVANT le périmètre « none ». Quand
 * `figmaConnected` est faux, aucune recherche n'a eu lieu (BACK-8 : « aucun appel MCP
 * n'est tenté ») : le message d'incitation + lien Paramètres est la seule chose vraie à
 * dire, un message de périmètre vide par-dessus ne ferait que masquer l'action utile.
 *
 * Le message « périmètre none » n'est montré QUE quand la grille serait vide (Figma
 * connecté, zéro composant) : avec de vraies recommandations, les cartes s'affichent —
 * la recherche Figma ne dépend pas du périmètre de comparaison Jira.
 */
export function componentsSectionKind(input: {
  figmaConnected: boolean;
  componentsCount: number;
  scopeNone: boolean;
}): ComponentsSectionKind {
  if (!input.figmaConnected) return { kind: "figma_disconnected" };
  if (input.componentsCount > 0) return { kind: "cards" };
  return input.scopeNone ? { kind: "scope_none" } : { kind: "no_components" };
}

/**
 * Dérivation front du périmètre « none » (BACK-5), MODE MANUEL SEUL.
 *
 * Le contrat ne porte pas la méthode de résolution (`ScopeMethod` n'est pas exposé dans
 * l'événement `components` — candidat avenant BACK-8). En mode manuel elle reste
 * dérivable à l'identique de `resolveManualScope` (`lib/jira-scope.ts`, ligne 261) :
 * champ « Epic / composant » vide ⇒ `none`, rempli ⇒ `epic_component`. En mode Jira,
 * aucun canal côté front : ne pas appeler cette fonction pour décider d'un message Jira.
 */
export function manualScopeIsNone(scopeHint: string | undefined): boolean {
  return (scopeHint ?? "").trim() === "";
}
