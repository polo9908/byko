import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { RECON_MAX_NODES, type BridgeMessage, type ReconNode } from "../../shared/browserAutomation"
import type { BridgeLogger } from "./bridge"

export interface ReconBridge {
  send: (message: BridgeMessage) => void
}

export interface ReconOptions {
  bridge: ReconBridge
  logger: BridgeLogger
  /** Répertoire où déposer le relevé. */
  outputDir: string
  /** Origine à relever, par exemple `https://console.cloud.google.com`. */
  origin: string
}

/**
 * Reconnaissance d'une page, pour écrire les sélecteurs d'une recette.
 *
 * Outil de **maintenance**, jamais activé en usage normal : il demande à
 * l'extension de relever la structure d'un onglet ouvert par l'utilisateur, et
 * écrit le relevé sur disque pour que l'auteur de la recette en tire les
 * sélecteurs réels — au lieu de les inventer.
 *
 * L'onglet visé est celui que l'utilisateur a ouvert lui-même : rien n'est
 * navigué, rien n'est rempli, rien n'est cliqué.
 */
export class BrowserAutomationRecon {
  private pendingId: string | null = null

  constructor(private readonly options: ReconOptions) {}

  /** Demande un relevé et rend l'identifiant de la demande. */
  request(): string {
    const requestId = randomUUID()
    this.pendingId = requestId
    this.options.logger.info(`relevé demandé pour ${this.options.origin}`)
    this.options.bridge.send({ type: "recon", requestId, origin: this.options.origin })
    return requestId
  }

  /** Traite une réponse de l'extension. Rend `true` si elle nous concernait. */
  handleMessage(message: BridgeMessage): boolean {
    if (message.type !== "reconResult" && message.type !== "reconFailed") return false
    if (!this.pendingId || message.requestId !== this.pendingId) return false
    this.pendingId = null

    if (message.type === "reconFailed") {
      this.options.logger.warn(`relevé impossible : ${message.reason}`)
      return true
    }

    const path = join(this.options.outputDir, `recon-${Date.now()}.json`)
    const payload = {
      capturedAt: new Date().toISOString(),
      origin: this.options.origin,
      url: message.url,
      nodeCount: message.nodes.length,
      truncated: message.nodes.length >= RECON_MAX_NODES,
      nodes: message.nodes,
    }
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    // Seul le décompte est journalisé : le relevé lui-même peut contenir des
    // libellés d'interface, jamais des valeurs de champ.
    this.options.logger.info(`relevé écrit : ${path} (${message.nodes.length} élément(s))`)
    return true
  }
}

/** Trie les éléments pour rendre le relevé lisible : ceux qui portent un libellé d'abord. */
export function sortReconNodes(nodes: readonly ReconNode[]): ReconNode[] {
  return [...nodes].sort((left, right) => {
    if (Boolean(left.name) !== Boolean(right.name)) return left.name ? -1 : 1
    return left.tag.localeCompare(right.tag)
  })
}
