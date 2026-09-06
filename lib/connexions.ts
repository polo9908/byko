/**
 * FRONT-2 — logique pure de l'écran Connexions (sans DOM, testable sous node:test).
 *
 * Contient uniquement ce qui peut être décidé sans rendu : l'ordre des blocs et le choix
 * du bloc à ouvrir au premier affichage. Le reste de l'écran (accordéon, formulaires,
 * liens dynamiques) vit dans `components/connexions-screen.tsx`.
 */

import type { ConnectionBlockId, SettingsState } from "./types/settings";

/** Ordre d'affichage et d'ouverture des blocs (artboard « 2 — Connexions »). */
export const CONNEXION_ORDER: readonly ConnectionBlockId[] = [
  "jira",
  "figma",
  "ai",
];

/**
 * Statuts qui comptent comme « bloc traité » (donc replié et sauté) au premier affichage.
 * `connected` partout ; `skipped` ne concerne que Figma (« Passer cette étape »).
 */
function isDone(settings: SettingsState, block: ConnectionBlockId): boolean {
  return settings[block].status === "connected" || settings[block].status === "skipped";
}

/**
 * Bloc à ouvrir au premier affichage : le premier de l'ordre qui n'est pas encore traité.
 * `null` quand tous les blocs sont connectés (ou passés pour Figma) — l'écran s'affiche
 * alors avec tous les blocs repliés, l'utilisateur rouvre celui qu'il veut modifier.
 */
export function firstBlockToConfigure(settings: SettingsState): ConnectionBlockId | null {
  return CONNEXION_ORDER.find((block) => !isDone(settings, block)) ?? null;
}
