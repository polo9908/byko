/**
 * Complétion fantôme locale (« ghost text », contrat : docs/ipc/personal-vocabulary.md).
 * Pure : le composant fournit le corpus (raccourcis appris, questions types) et
 * reçoit le reste de phrase à afficher en grisé après le curseur. Aucun appel
 * réseau, aucune IA : uniquement des préfixes de chaînes connues localement.
 */

/** En dessous, une complétion sur deux ou trois lettres serait du bruit. */
export const GHOST_MIN_CHARS = 3

/**
 * Reste de la phrase la plus courte du corpus qui commence par ce que l'utilisateur
 * a déjà tapé, ou `null`. La comparaison ignore la casse ; le reste renvoyé garde
 * la casse d'origine. Un candidat plus court gagne (complétion la moins intrusive).
 */
export function completeTyped(typed: string, corpus: string[]): string | null {
  if (typed.trim().length < GHOST_MIN_CHARS) return null
  const needle = typed.toLowerCase()
  let best: string | null = null
  for (const candidate of corpus) {
    if (typeof candidate !== "string" || candidate.length <= typed.length) continue
    if (candidate.slice(0, typed.length).toLowerCase() !== needle) continue
    if (best === null || candidate.length < best.length) best = candidate
  }
  return best === null ? null : best.slice(typed.length)
}
