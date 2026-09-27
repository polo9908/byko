/**
 * Helper de messagerie native : le seul code que Chrome lance directement.
 *
 * Son unique rôle est de relayer les messages entre l'extension (cadre natif
 * sur stdin/stdout) et le processus main de BYKO (JSON par ligne sur un socket
 * local). Il ne décide rien et n'interprète aucun message.
 *
 * `stdout` est réservé au protocole : toute trace part sur `stderr`.
 */
import { createConnection } from "node:net"
import { browserAutomationSocketPath } from "../main/browser-automation/socket-path"
import { NativeMessageDecoder, encodeNativeMessage } from "./native-protocol"

function trace(message: string): void {
  process.stderr.write(`[byko-native-host] ${message}\n`)
}

const socketPath = browserAutomationSocketPath()
const decoder = new NativeMessageDecoder()
const connection = createConnection(socketPath)
let bykoReady = false
let buffer = ""

function sendToExtension(message: unknown): void {
  process.stdout.write(encodeNativeMessage(message))
}

function relayToByko(message: unknown): void {
  if (!bykoReady) {
    trace("BYKO n'est pas joignable, message abandonné.")
    return
  }
  connection.write(`${JSON.stringify(message)}\n`)
}

connection.setEncoding("utf8")
connection.on("connect", () => {
  bykoReady = true
  trace(`connecté à BYKO (${socketPath})`)
})
connection.on("data", (chunk: string | Buffer) => {
  buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
  let index = buffer.indexOf("\n")
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim()) {
      try {
        sendToExtension(JSON.parse(line))
      } catch {
        trace("message de BYKO illisible, ignoré.")
      }
    }
    index = buffer.indexOf("\n")
  }
})
connection.on("error", (error: Error) => {
  trace(`BYKO injoignable : ${error.message}`)
  // Sortir en erreur fait remonter une cause lisible à l'extension, plutôt
  // qu'un port ouvert dans le vide.
  process.exit(1)
})
connection.on("close", () => {
  trace("BYKO a fermé le pont.")
  process.exit(0)
})

process.stdin.on("data", (chunk: Buffer) => {
  let messages: unknown[]
  try {
    messages = decoder.push(chunk)
  } catch (error) {
    trace(`flux natif illisible : ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  for (const message of messages) relayToByko(message)
})

process.stdin.on("end", () => {
  trace("Chrome a fermé l'entrée standard.")
  process.exit(0)
})
