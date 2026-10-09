import { requireActiveAccount } from "../accountPaths"
import { shell } from "electron"
import { deleteSecret, getSecret, setSecret } from "../secrets"
import type { FigmaConnectionStatus } from "../../shared/figma"
import type { DesignStatus } from "../../shared/links"

/**
 * Intégration Figma (ticket E5). Même principe que Jira (E1) et l'IA (E2) :
 * le jeton ne transite jamais vers le renderer une fois saisi, seul un
 * statut dérivé (handle/e-mail) est renvoyé via IPC.
 */

const SECRET_KEY = "figma.apiToken"
// Les jetons personnels Figma se créent depuis l'onglet « Sécurité » des réglages de compte.
const TOKEN_PAGE_URL = "https://www.figma.com/settings"

/** Le message d'erreur de `fetch` peut citer la valeur d'un en-tête : seul un message fixe remonte. */
async function figmaFetch(token: string, path: string): Promise<Response> {
  try {
    return await fetch(`https://api.figma.com/v1${path}`, {
      headers: { "X-Figma-Token": token },
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error("Figma ne répond pas (réseau, délai dépassé ou jeton mal formé).")
  }
}

/** Ouvre la page de création de jeton Figma dans le navigateur système, jamais dans une fenêtre interne. */
export async function openTokenPage(): Promise<void> {
  await shell.openExternal(TOKEN_PAGE_URL)
}

export async function connect(token: string): Promise<FigmaConnectionStatus> {
  requireActiveAccount() // avant tout envoi : sans compte connecté, le jeton ne quitte pas l'appareil
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

/** Clé de fichier Figma : alphanumérique, jamais de séparateur de chemin. */
const FILE_KEY = /^[A-Za-z0-9]{10,64}$/
/** Profondeur lue : pages, cadres et sections de premier niveau, cadres rangés dans une section. */
const NODE_DEPTH = 3
const MAX_NODES_PER_FILE = 5000

async function requireToken(): Promise<string> {
  const token = await getSecret(SECRET_KEY)
  if (!token) throw new Error("Figma n'est pas connecté.")
  return token
}

/**
 * Accepte la clé d'un fichier ou son lien collé tel quel (`figma.com/design/<clé>/…`) ; seule la clé est gardée,
 * l'adresse appelée est toujours reconstruite ici sur `api.figma.com`.
 */
export function assertFileKey(value: string): string {
  const text = value.trim()
  const fromUrl = /^https:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(text)
  const key = fromUrl ? fromUrl[1] : text
  if (!FILE_KEY.test(key)) {
    throw new Error("Fichier Figma invalide : collez le lien du fichier (figma.com/design/…).")
  }
  return key
}

/** Vérifie que le jeton lit bien le fichier et renvoie son nom. */
export async function fetchFileName(fileKey: string): Promise<string> {
  const token = await requireToken()
  const response = await figmaFetch(token, `/files/${fileKey}?depth=1`)
  if (!response.ok) {
    throw new Error(
      `Fichier Figma inaccessible (${response.status}). Vérifiez le lien et que le jeton autorise la lecture des fichiers.`,
    )
  }
  const body = (await response.json()) as { name?: unknown }
  return typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : fileKey
}

export interface FigmaNamedNode {
  id: string
  name: string
  url: string
  status: DesignStatus
}

interface RawFigmaNode {
  id?: unknown
  name?: unknown
  devStatus?: { type?: unknown } | null
  children?: unknown
}

/**
 * Pages, sections et cadres du fichier, avec leur statut Dev Mode (`devStatus` : « Ready for dev », « Completed »).
 * Le rapprochement avec les tickets (clé Jira dans le nom) se fait dans `linkSync.ts`.
 */
export async function listNamedNodes(fileKey: string): Promise<FigmaNamedNode[]> {
  const token = await requireToken()
  const response = await figmaFetch(token, `/files/${fileKey}?depth=${NODE_DEPTH}`)
  if (!response.ok) {
    throw new Error(`Lecture du fichier Figma impossible (${response.status}).`)
  }
  const body = (await response.json()) as { document?: RawFigmaNode }
  const nodes: FigmaNamedNode[] = []
  const visit = (node: RawFigmaNode, depth: number): void => {
    if (nodes.length >= MAX_NODES_PER_FILE) return
    if (depth > 0 && typeof node.id === "string" && typeof node.name === "string") {
      const devStatus = node.devStatus?.type
      nodes.push({
        id: node.id,
        name: node.name.slice(0, 200),
        url: `https://www.figma.com/design/${fileKey}/?node-id=${encodeURIComponent(node.id.replace(/:/g, "-"))}`,
        status: devStatus === "READY_FOR_DEV" ? "ready_for_dev" : devStatus === "COMPLETED" ? "completed" : "in_progress",
      })
    }
    if (depth < NODE_DEPTH && Array.isArray(node.children)) {
      for (const child of node.children as RawFigmaNode[]) visit(child, depth + 1)
    }
  }
  if (body.document) visit(body.document, 0)
  return nodes
}
