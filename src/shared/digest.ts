/** Digest de la vue journée : les quelques points à regarder aujourd'hui, choisis selon le rôle (contrat : docs/ipc/digest.md). */

import type { ProfileRole } from "./profile"

export type DigestKind =
  /** Ticket ouvert dont dépendent d'autres tickets ouverts (lien Jira « bloque »). */
  | "blocker"
  /** Ticket ouvert qui attend un autre ticket ouvert. */
  | "blocked"
  /** Ticket en cours sans aucune activité Jira depuis `DIGEST_STALE_DAYS` jours ou plus. */
  | "stale"
  /** Décisions de réunion à consigner dans la Mémoire. */
  | "proposal"
  /** Passages à « terminé » proposés (pull requests fusionnées), à valider dans le Journal. */
  | "transition"
  /** Maquette Figma marquée prête pour le développement. */
  | "design-ready"

export interface DigestItem {
  /** Stable d'un appel à l'autre pour un même fait : sert de clé React et à ne notifier qu'une fois. */
  id: string
  kind: DigestKind
  text: string
  detail?: string
  /** Toujours en https (ticket Jira, maquette Figma) : ouvert dans le navigateur. */
  url?: string
  /** Écran de BYKO où le point se traite, quand il n'y a pas de lien externe. */
  target?: "memory" | "journal"
}

export interface DailyDigest {
  /** Rôle utilisé pour choisir et ordonner les points ; absent : sélection générale. */
  role?: ProfileRole
  /** `DIGEST_MAX_ITEMS` au plus, les plus importants pour ce rôle d'abord. */
  items: DigestItem[]
}

export const DIGEST_MAX_ITEMS = 4
export const DIGEST_MAX_PER_KIND = 2
export const DIGEST_STALE_DAYS = 5

/** Ce que chaque rôle voit, dans l'ordre : un type absent de la liste n'est pas montré à ce rôle. */
export const DIGEST_KINDS_BY_ROLE: Record<ProfileRole | "default", DigestKind[]> = {
  product: ["blocker", "stale", "proposal", "transition"],
  manager: ["blocker", "stale", "proposal", "transition"],
  dev: ["transition", "blocked", "design-ready", "blocker", "stale"],
  design: ["design-ready", "proposal", "blocker"],
  architect: ["proposal", "blocker", "stale"],
  qa: ["transition", "blocker", "stale"],
  default: ["blocker", "proposal", "transition", "stale"],
}
