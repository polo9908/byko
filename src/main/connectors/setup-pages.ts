import { shell } from "electron"
import type { ConnectorSetupPage } from "../../shared/connectors"

/**
 * Pages d'aide des connecteurs sans backend (E3, D2), ouvertes depuis
 * l'écran Réglages. Même principe que Google Agenda : les URL vivent ici et
 * nulle part ailleurs, le renderer n'envoie qu'un identifiant de liste
 * blanche (voir `docs/ipc/connector-setup-guides.md`).
 */
const SETUP_PAGE_URLS: Record<ConnectorSetupPage, string> = {
  slackCreateApp: "https://api.slack.com/apps",
  microsoftEntraApps: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
  githubTokens: "https://github.com/settings/tokens",
}

/** Ouvre la page dans le navigateur système, jamais dans une fenêtre interne. */
export async function openSetupPage(page: ConnectorSetupPage): Promise<void> {
  await shell.openExternal(SETUP_PAGE_URLS[page])
}
