/**
 * BACK-9 — Fraîcheur d'un résultat d'analyse face à l'état courant du ticket.
 *
 * Fonction PURE : mêmes entrées → mêmes sorties, aucune E/S, aucune lecture, aucune heure
 * système. Elle compare la date de dernière modification Jira du contenu ANALYSÉ
 * (`entry.updatedAt`, l'enregistrement de BACK-10) à la date `updated` courante du ticket :
 * si le ticket a été modifié après le contenu analysé, le résultat connu est périmé.
 *
 * Pourquoi comparer les `updated`, et pas `analyzedAt` ni une relecture du contenu :
 * - `updated` est la sémantique Jira de « le contenu a changé à cette date » : si le
 *   `updated` courant est postérieur au `updated` du snapshot analysé, le contenu analysé
 *   n'est plus l'état courant — le résultat ne peut plus être présenté comme frais ;
 * - comparer à `analyzedAt` (heure de l'analyse) reviendrait au même dans un snapshot
 *   cohérent (le snapshot est lu pendant l'analyse, donc `updated` ≤ `analyzedAt`), mais la
 *   date du snapshot est la source exacte de l'état comparé ;
 * - relire le contenu complet pour re-hashé serait plus lourd que le champ `updated`, qui
 *   voyage dans la même lecture de ticket — BACK-9 (ligne 127 des tickets) compare des
 *   dates, pas des contenus.
 *
 * Trois états, jamais deux (règle du projet) : `staleSince` ne peut pas être « absent » à la
 * fois parce que le résultat est à jour et parce que la fraîcheur est indécidable. `unknown`
 * porte la raison, sans jamais citer le contenu du ticket ni sa clé.
 */

/**
 * Verdict de fraîcheur, produit par la comparaison pure des dates. `unknown.reason` est
 * destiné à être affiché tel quel — il ne recopie aucune donnée du ticket.
 */
export type FreshnessOutcome =
  | { status: "fresh" }
  | { status: "stale"; staleSince: string }
  | { status: "unknown"; reason: string };

const REASON_NO_ANALYZED_DATE =
  "L'analyse enregistrée ne porte pas de date de source : la fraîcheur du résultat ne peut pas être vérifiée.";
const REASON_NO_CURRENT_DATE =
  "Le ticket n'a pas de date de modification connue (introuvable dans Jira, ou date absente) : la fraîcheur du résultat ne peut pas être vérifiée.";
const REASON_UNREADABLE_ANALYZED_DATE =
  "La date de source de l'analyse enregistrée est illisible : la fraîcheur du résultat ne peut pas être vérifiée.";
const REASON_UNREADABLE_CURRENT_DATE =
  "La date de modification courante du ticket est illisible : la fraîcheur du résultat ne peut pas être vérifiée.";

/**
 * Compare la date de source d'une analyse enregistrée à la date `updated` courante du
 * ticket. `staleSince` porte la date de la MODIFICATION COURANTE (le `updated` Jira lu
 * maintenant) : c'est la date à laquelle le contenu a changé — donc la date à partir de
 * laquelle le résultat connu est périmé (décision BACK-9 n°3, `docs/api-contracts.md`).
 *
 * `null` sur l'une des deux dates = information manquante, pas « à jour » : la fraîcheur est
 * indécidable et le résultat est `unknown` — jamais présenté comme frais par défaut.
 */
export function assessFreshness(
  analyzedUpdatedAt: string | null,
  currentUpdatedAt: string | null,
): FreshnessOutcome {
  if (analyzedUpdatedAt === null) {
    return { status: "unknown", reason: REASON_NO_ANALYZED_DATE };
  }
  if (currentUpdatedAt === null) {
    return { status: "unknown", reason: REASON_NO_CURRENT_DATE };
  }

  const analyzedMs = Date.parse(analyzedUpdatedAt);
  const currentMs = Date.parse(currentUpdatedAt);
  if (Number.isNaN(analyzedMs)) {
    return { status: "unknown", reason: REASON_UNREADABLE_ANALYZED_DATE };
  }
  if (Number.isNaN(currentMs)) {
    return { status: "unknown", reason: REASON_UNREADABLE_CURRENT_DATE };
  }

  // À égalité, le contenu n'a pas changé depuis le snapshot : frais. Un `updated` courant
  // ANTÉRIEUR au snapshot (incohérence de source) n'est pas une modification postérieure :
  // frais aussi — on ne fabrique pas une péremption qu'aucune modification n'établit.
  if (currentMs > analyzedMs) {
    return { status: "stale", staleSince: currentUpdatedAt };
  }
  return { status: "fresh" };
}
