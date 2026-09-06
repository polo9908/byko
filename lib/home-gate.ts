/**
 * FRONT-1 — aiguillage de l'écran d'accueil selon l'état réel de la configuration.
 *
 * L'écran Intro ne s'affiche qu'« au tout premier lancement », et la détection passe par
 * l'état réel renvoyé par `GET /api/settings`, jamais par un flag local trivial à
 * contourner (critère d'acceptation de FRONT-1, `docs/tickets/phase-1-configuration.md`).
 *
 * Le seul signal fiable est le marqueur explicite `onboardingCompleted` (avenant BACK-4,
 * décision n°2 du 31/08/2026, `docs/api-contracts.md`) : il n'est PAS dérivable des trois
 * statuts de connexion — un utilisateur ayant terminé le wizard puis dont un jeton expire
 * ne doit pas retomber sur l'Intro (les trois blocs seraient de nouveau non connectés). Il
 * passe à `true` uniquement quand FRONT-5 marque la configuration initiale comme terminée.
 *
 * Conséquence assumée : tant que le wizard n'est pas terminé (`onboardingCompleted ===
 * false`), l'Intro se réaffiche au rechargement — le marqueur est le seul état que le
 * produit a arbitré pour distinguer « premier lancement » de « déjà configuré ».
 */

import type { GetSettingsResponse } from "./types/settings";

export type HomeView = "loading" | "intro" | "main" | "error";

export interface HomeGate {
  view: Exclude<HomeView, "loading">;
  /** Cause de l'affichage `error`, à présenter telle quelle (message du backend). */
  message?: string;
}

/**
 * Décide de la vue d'accueil à partir de la réponse de `GET /api/settings`.
 *
 * La variante `error` du contrat ne doit jamais être confondue avec un état vide : une
 * panne de lecture (coffre chiffré illisible, clé absente) ne doit pas resservir
 * l'onboarding à un utilisateur déjà configuré — elle affiche l'erreur à la place.
 */
export function resolveHomeView(get: GetSettingsResponse): HomeGate {
  if (get.status === "error") {
    return { view: "error", message: get.message };
  }
  return get.settings.onboardingCompleted ? { view: "main" } : { view: "intro" };
}
