import { shell } from "electron"
import { deleteSecret, getSecret, setSecret } from "../secrets"
import type { FigmaConnectionStatus } from "../../shared/figma"

/**
 * Intégration Figma (ticket E5). Même principe que Jira (E1) et l'IA (E2) :
 * le jeton ne transite jamais vers le renderer une fois saisi, seul un
 * statut dérivé (handle/e-mail) est renvoyé via IPC.
 */

const SECRET_KEY = "figma.apiToken"
// Les jetons personnels Figma se créent depuis l'onglet « Sécurité » des réglages de compte.
const TOKEN_PAGE_URL = "https://www.figma.com/settings"

async function figmaFetch(token: string, path: string): Promise<Response> {
  return fetch(`https://api.figma.com/v1${path}`, {
    headers: { "X-Figma-Token": token },
  })
}

/** Ouvre la page de création de jeton Figma dans le navigateur système, jamais dans une fenêtre interne. */
export async function openTokenPage(): Promise<void> {
  await shell.openExternal(TOKEN_PAGE_URL)
}

export async function connect(token: string): Promise<FigmaConnectionStatus> {
  const response = await figmaFetch(token, "/me")
  if (!response.ok) {
    throw new Error(`Connexion Figma refusée (${response.status}). Vérifiez le jeton.`)
  }
  const me = (await response.json()) as { handle?: string; email?: string }
  await setSecret(SECRET_KEY, token)
  return { connected: true, handle: me.handle, email: me.email }
}

export async function getStatus(): Promise<FigmaConnectionStatus> {
  const token = await getSecret(SECRET_KEY)
  return { connected: Boolean(token) }
}

export async function disconnect(): Promise<void> {
  await deleteSecret(SECRET_KEY)
}
