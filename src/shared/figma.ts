/**
 * Types partagés pour l'intégration Figma (ticket E5). Aucune valeur
 * secrète ne doit transiter par ce fichier.
 */

export interface FigmaConnectionStatus {
  connected: boolean
  handle?: string
  email?: string
}
