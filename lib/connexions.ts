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

/* -------------------------------------------------------------------------- */
/* FRONT-4 — blocages de l'écran Connexions (bandeau + « Terminer »)           */
/* -------------------------------------------------------------------------- */

/** Un bloc qui empêche de terminer la configuration. */
export interface BlockIssue {
  block: "jira" | "ai";
  message: string;
}

/**
 * Messages par défaut quand aucun `lastError` persisté n'explique le blocage. Le libellé
 * exact d'un échec récent est porté par `lastError.message` (BACK-4) ou par la dernière
 * réponse de test (côté composant) ; ces défauts ne servent que pour « jamais saisi ».
 */
export const DEFAULT_JIRA_ISSUE =
  "Jira n'est pas connecté : renseigne l'URL de l'instance, ton e-mail et un jeton API valide.";
export const DEFAULT_AI_ISSUE =
  "Le modèle IA n'est pas connecté : choisis un fournisseur et colle une clé valide.";

/**
 * Blocs qui empêchent de cliquer « Terminer » (FRONT-4, ligne 265) : Jira et le modèle IA
 * doivent être `connected` ; Figma peut rester `not_connected` ou `skipped`. L'ordre est
 * stable (Jira puis IA). La cause affichée est le `lastError` persisté s'il existe, sinon
 * le message par défaut — jamais un simple « non connecté » sans explication.
 */
export function blockingIssues(settings: SettingsState): BlockIssue[] {
  const issues: BlockIssue[] = [];
  if (settings.jira.status !== "connected") {
    issues.push({
      block: "jira",
      message:
        settings.jira.status === "not_connected" && settings.jira.lastError?.message
          ? settings.jira.lastError.message
          : DEFAULT_JIRA_ISSUE,
    });
  }
  if (settings.ai.status !== "connected") {
    issues.push({
      block: "ai",
      message:
        settings.ai.status === "not_connected" && settings.ai.lastError?.message
          ? settings.ai.lastError.message
          : DEFAULT_AI_ISSUE,
    });
  }
  return issues;
}
