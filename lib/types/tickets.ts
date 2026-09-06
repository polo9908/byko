/**
 * BACK-10 (fin, câblage FRONT-7) — contrat de `GET /api/tickets`, la liste de gauche de
 * l'espace de travail. Voir `docs/api-contracts.md`, §« GET /api/tickets (espace de
 * travail) ».
 */

/**
 * Un ticket de la liste de gauche. Les champs prioritaires sont normalisés depuis Jira ;
 * l'ordre de la liste est l'ordre RENVOYÉ PAR JIRA (ordre serveur), jamais réordonné côté
 * client (règle produit FRONT-7, ligne 17 : « jamais réordonné par le statut d'analyse »).
 */
export interface TicketListItem {
  key: string;
  summary: string;
  /** Nom de priorité tel que Jira le sert (ex. « Highest »). */
  priorityName: string;
  /** Icône de priorité Jira (URL publique), si présente dans la réponse. */
  priorityIconUrl?: string;
  /** Date de dernière modification (ISO), ou `null` si indisponible. */
  updatedAt: string | null;
  /** Dérivé de l'historique BACK-10 : présent si une entrée existe pour cette clé. */
  alreadyAnalyzed: boolean;
}

/**
 * Réponse de `GET /api/tickets`.
 *
 * `jiraConnected: false` (succès, liste vide) quand Jira n'est pas connecté : c'est l'état
 * normal du mode manuel (FRONT-7 remplace alors la liste par le formulaire de saisie). Un
 * échec de LECTURE du coffre répond `error` — jamais rabattu sur « Jira non connecté ».
 */
export type GetTicketsResponse =
  | { status: "success"; jiraConnected: boolean; tickets: TicketListItem[] }
  | { status: "error"; message: string };
