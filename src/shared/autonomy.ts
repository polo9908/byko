/**
 * Types partagés pour l'autonomie par catégorie (ticket C3). `level` va de
 * 0 à `MAX_LEVEL` (un cran par pastille affichée) ; `MAX_LEVEL` = autonome,
 * en dessous = « Encore N validations » avant de devenir autonome.
 */
export const AUTONOMY_MAX_LEVEL = 5

export type AutonomyCategoryId = "relances" | "tickets-prets" | "criteres-recette" | "alignement-figma"

export const AUTONOMY_CATEGORY_IDS: AutonomyCategoryId[] = [
  "relances",
  "tickets-prets",
  "criteres-recette",
  "alignement-figma",
]

export interface AutonomyCategory {
  id: AutonomyCategoryId
  label: string
  level: number
}
