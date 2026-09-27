/**
 * Registre générique des connecteurs (ticket E7). Un seul type de résumé,
 * consommé par `window.api.settings.listConnectors()`, pour que l'écran
 * Réglages (D1) n'ait pas à connaître le détail de chaque intégration.
 */

/** Connecteurs réellement branchés : on peut s'y connecter depuis Réglages. */
export type ConnectableConnectorId = "jira" | "ai" | "figma" | "calendar"

/**
 * Connecteurs annoncés dans Réglages (D1) mais sans backend : leur guide
 * reste consultable (« Voir comment faire »), la connexion est inactive
 * (voir tickets E3 et D2 du backlog).
 */
export type UpcomingConnectorId = "slack" | "teams" | "outlook" | "github"

export type ConnectorId = ConnectableConnectorId | UpcomingConnectorId

export interface ConnectorSummary {
  id: ConnectableConnectorId
  label: string
  letter: string
  color: string
  connected: boolean
  detail?: string
}

/**
 * Pages d'aide ouvrables depuis les guides des connecteurs sans backend.
 * Les URL vivent côté main uniquement (liste blanche) : le renderer n'envoie
 * qu'un identifiant, jamais une URL (voir `docs/ipc/connector-setup-guides.md`).
 */
export type ConnectorSetupPage = "slackCreateApp" | "microsoftEntraApps" | "githubTokens"

export const CONNECTOR_SETUP_PAGES: readonly ConnectorSetupPage[] = [
  "slackCreateApp",
  "microsoftEntraApps",
  "githubTokens",
]
