import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { dirname } from "node:path"
import {
  BRIDGE_PING_TIMEOUT_MS,
  type BridgeMessage,
  type BrowserAutomationBridgeStatus,
} from "../../shared/browserAutomation"

export interface BridgeLogger {
  info: (message: string) => void
  warn: (message: string) => void
}

/** Cadence du ping de maintien de vie, une fois l'extension connectée. */
const KEEPALIVE_INTERVAL_MS = 30_000

/**
 * Extrémité côté BYKO du pont d'automatisation : un socket local sur lequel le
 * helper natif relaie les messages de l'extension.
 *
 * Volontairement sans dépendance à Electron — le chemin du socket et le
 * journal sont injectés — pour rester exécutable hors de l'application, donc
 * testable.
 *
 * Aucune méthode n'expose de secret ni n'accepte d'ordre : en phase ② le pont
 * sait seulement dire s'il est joignable et mesurer un aller-retour.
 */
export class BrowserAutomationBridge {
  /**
   * Reçoit les messages que le pont ne traite pas lui-même (`step`, `capture`,
   * `finished`). Branché sur l'exécuteur de recettes. Sans lui, ces messages
   * sont simplement ignorés.
   */
  onMessage: ((message: BridgeMessage) => void) | null = null

  /** Appelé quand une extension s'annonce. Sert à déclencher ce qui exige une connexion. */
  onConnected: (() => void) | null = null

  private server: Server | null = null
  private socket: Socket | null = null
  private keepalive: ReturnType<typeof setInterval> | null = null
  private extensionVersion: string | null = null
  private lastRoundTripMs: number | null = null
  private readonly pending = new Map<string, { sentAt: number; timer: ReturnType<typeof setTimeout> }>()

  constructor(
    private readonly socketPath: string,
    private readonly logger: BridgeLogger,
  ) {}

  get status(): BrowserAutomationBridgeStatus {
    return {
      state: this.socket ? "connected" : this.server ? "listening" : "stopped",
      extensionVersion: this.extensionVersion,
      lastRoundTripMs: this.lastRoundTripMs,
    }
  }

  start(): void {
    if (this.server) return
    mkdirSync(dirname(this.socketPath), { recursive: true })
    if (process.platform !== "win32" && existsSync(this.socketPath)) {
      // Un fichier resté d'un arrêt brutal empêcherait `listen` de s'attacher.
      rmSync(this.socketPath, { force: true })
    }

    const server = createServer((socket) => this.handleConnection(socket))
    server.on("error", (error) => {
      this.logger.warn(`serveur en erreur (${describeError(error)})`)
    })
    server.listen(this.socketPath, () => {
      if (process.platform !== "win32") {
        // Le socket ne doit être lisible que par le compte de l'utilisateur.
        chmodSync(this.socketPath, 0o600)
      }
      this.logger.info(`à l'écoute (${this.socketPath})`)
    })
    this.server = server
  }

  stop(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.clearPending()
    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (process.platform !== "win32") {
      try {
        rmSync(this.socketPath, { force: true })
      } catch {
        // Déjà retiré : rien à signaler.
      }
    }
  }

  /** Envoie un ping et rend l'identifiant de l'aller-retour. `null` si rien n'est connecté. */
  ping(): string | null {
    if (!this.socket) return null
    const id = randomUUID()
    this.pending.set(id, {
      sentAt: Date.now(),
      timer: setTimeout(() => {
        if (this.pending.delete(id)) {
          this.logger.warn("aller-retour sans réponse (délai dépassé)")
        }
      }, BRIDGE_PING_TIMEOUT_MS),
    })
    this.send({ type: "ping", id, sentAt: Date.now() })
    return id
  }

  /** Envoie un message à l'extension. Rend `false` si rien n'est connecté. */
  sendToExtension(message: BridgeMessage): boolean {
    if (!this.socket) return false
    this.send(message)
    return true
  }

  private send(message: BridgeMessage): void {
    this.socket?.write(`${JSON.stringify(message)}\n`)
  }

  private handleConnection(socket: Socket): void {
    if (this.socket) {
      // Une seule extension à la fois : on ferme la connexion surnuméraire
      // plutôt que de laisser deux interlocuteurs se disputer l'état.
      socket.destroy()
      return
    }
    this.socket = socket
    let buffer = ""
    socket.on("data", (chunk: string | Buffer) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      let index = buffer.indexOf("\n")
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line.trim()) this.handleLine(line)
        index = buffer.indexOf("\n")
      }
    })
    socket.on("close", () => this.handleDisconnect())
    socket.on("error", (error) => {
      this.logger.warn(`connexion en erreur (${describeError(error)})`)
      this.handleDisconnect()
    })
    this.logger.info("extension connectée")
  }

  private handleDisconnect(): void {
    if (!this.socket) return
    this.socket = null
    this.stopKeepalive()
    this.clearPending()
    this.logger.info("extension déconnectée")
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.logger.warn("message illisible, ignoré")
      return
    }
    if (!isBridgeMessage(parsed)) {
      this.logger.warn("message de forme inconnue, ignoré")
      return
    }

    switch (parsed.type) {
      case "hello":
        this.extensionVersion = parsed.extensionVersion
        this.logger.info(`extension connectée (version ${parsed.extensionVersion})`)
        this.ping()
        this.startKeepalive()
        this.onConnected?.()
        break
      case "ping":
        this.send({ type: "pong", id: parsed.id })
        break
      case "pong": {
        const entry = this.pending.get(parsed.id)
        if (!entry) return
        clearTimeout(entry.timer)
        this.pending.delete(parsed.id)
        // Mesuré entre l'envoi et la réception, dans le processus main : une
        // seule horloge, donc une durée qui veut dire quelque chose.
        this.lastRoundTripMs = Date.now() - entry.sentAt
        this.logger.info(`aller-retour confirmé en ${this.lastRoundTripMs} ms`)
        break
      }
      case "log":
        this.logger.info(`extension : ${parsed.message}`)
        break
      default:
        this.onMessage?.(parsed)
        break
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive()
    this.keepalive = setInterval(() => this.ping(), KEEPALIVE_INTERVAL_MS)
  }

  private stopKeepalive(): void {
    if (this.keepalive) {
      clearInterval(this.keepalive)
      this.keepalive = null
    }
  }

  private clearPending(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
  }
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== "object" || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === "hello" || type === "ping" || type === "pong" || type === "log"
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
