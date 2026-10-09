import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { RECON_MAX_NODES, type BridgeMessage } from "../../shared/browserAutomation"
import type { BridgeLogger } from "./bridge"

export interface ReconBridge {
  send: (message: BridgeMessage) => void
}

export interface ReconOptions {
  bridge: ReconBridge
  logger: BridgeLogger
  /** Répertoire où déposer les relevés. */
  outputDir: string
  /**
   * Préfixes d'URL à relever, traités dans l'ordre. Un préfixe peut viser une
   * page précise (`https://console.cloud.google.com/projectcreate`) et pas
   * seulement un domaine, ce qui permet de relever plusieurs onglets ouverts.
   */
  urlPrefixes: readonly string[]
}

/**
 * Complète un préfixe d'URL pour qu'il forme un motif valide pour
 * `chrome.tabs.query` : le chemin doit commencer par une barre oblique.
 */
export function normalizeUrlPrefix(value: string): string {
  const trimmed = value.trim()
  const schemeEnd = trimmed.indexOf("://")
  if (schemeEnd === -1) return trimmed
  return trimmed.includes("/", schemeEnd + 3) ? trimmed : `${trimmed}/`
}

/**
 * Reconnaissance de pages, pour écrire les sélecteurs d'une recette.
 *
 * Outil de **maintenance**, jamais activé en usage normal : il demande à
 * l'extension de relever la structure d'onglets ouverts par l'utilisateur, et
 * écrit chaque relevé sur disque pour que l'auteur de la recette en tire les
 * sélecteurs réels — au lieu de les inventer.
 *
 * Les onglets visés sont ceux que l'utilisateur a ouverts lui-même : rien n'est
 * navigué, rien n'est rempli, rien n'est cliqué.
 */
export class BrowserAutomationRecon {
  private pendingId: string | null = null
  private currentPrefix: string | null = null
  private readonly queue: string[]

  constructor(private readonly options: ReconOptions) {
    this.queue = [...options.urlPrefixes]
  }

  /**
   * Lance la série : chaque réponse déclenche la demande suivante, ce qui permet
   * de relever plusieurs onglets en une seule exécution de BYKO.
   */
  start(): void {
    if (this.pendingId) return
    this.requestNext()
  }

  /** Traite une réponse de l'extension. Rend `true` si elle nous concernait. */
  handleMessage(message: BridgeMessage): boolean {
    if (message.type !== "reconResult" && message.type !== "reconFailed") return false
    if (!this.pendingId || message.requestId !== this.pendingId) return false

    const urlPrefix = this.currentPrefix
    this.pendingId = null
    this.currentPrefix = null

    if (message.type === "reconFailed") {
      this.options.logger.warn(`relevé impossible pour ${urlPrefix} : ${message.reason}`)
    } else {
      const path = join(this.options.outputDir, `recon-${Date.now()}-${this.queue.length}.json`)
      const payload = {
        capturedAt: new Date().toISOString(),
        urlPrefix,
        url: message.url,
        nodeCount: message.nodes.length,
        truncated: message.nodes.length >= RECON_MAX_NODES,
        nodes: message.nodes,
      }
      writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
      // Seul le décompte est journalisé : le relevé peut contenir des libellés
      // d'interface, jamais des valeurs de champ.
      this.options.logger.info(`relevé écrit : ${path} (${message.nodes.length} élément(s))`)
    }

    this.requestNext()
    return true
  }

  private requestNext(): void {
    const urlPrefix = this.queue.shift()
    if (urlPrefix === undefined) {
      this.options.logger.info("série de relevés terminée")
      return
    }
    const requestId = randomUUID()
    this.pendingId = requestId
    this.currentPrefix = urlPrefix
    this.options.logger.info(`relevé demandé pour ${urlPrefix}`)
    this.options.bridge.send({ type: "recon", requestId, urlPrefix })
  }
}
