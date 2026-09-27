/**
 * Types et utilitaires partagés entre le main process et le renderer pour
 * l'intégration Jira (voir `src/main/integrations/jira.ts`). Aucune valeur
 * secrète ne doit transiter par ce fichier.
 */

export interface JiraConnectionStatus {
  connected: boolean
  domain?: string
  email?: string
  displayName?: string
}

export interface JiraProjectSummary {
  id: string
  key: string
  name: string
}

export interface JiraTicketSummary {
  id: string
  key: string
  summary: string
  status: string
  url: string
}

/**
 * Heuristique de pré-remplissage du domaine Atlassian à partir de l'e-mail
 * (ex. `paul.lavergne99@outlook.fr` → `paullavergne99.atlassian.net`).
 * Le nom de site Atlassian correspond généralement au début de l'adresse
 * (partie locale, avant le @), pas au domaine de messagerie : un site Jira
 * personnel ou perso peut être chez outlook.fr/gmail.com sans rapport avec
 * le nom du site. Reste éditable côté UI (bouton « Modifier ») : c'est une
 * suggestion, pas une vérité, la vérification réelle se fait via `jira:connect`.
 */
export function guessJiraDomain(email: string): string {
  const atSign = email.indexOf("@")
  if (atSign === -1) return ""
  const localPart = email.slice(0, atSign)
  const site = localPart.toLowerCase().replace(/[^a-z0-9-]/g, "")
  return site ? `${site}.atlassian.net` : ""
}
