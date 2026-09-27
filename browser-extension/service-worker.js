/**
 * Pont côté navigateur.
 *
 * En phase ②, ce service worker ne fait qu'une chose : ouvrir le canal vers
 * BYKO et répondre aux pings. Aucune recette, aucune page lue, aucun accès au
 * DOM — l'extension ne déclare d'ailleurs aucune permission d'hôte : elle est
 * techniquement incapable de lire une page en l'état.
 *
 * Voir docs/ipc/browser-automation.md. Le nom de l'hôte doit correspondre à
 * celui qu'écrit scripts/install-native-host.mjs.
 */

const NATIVE_HOST_NAME = "com.byko.browser_automation"

/** Rythme de reconnexion quand BYKO n'est pas joignable (BYKO fermé, par exemple). */
const RETRY_DELAYS_MS = [1000, 5000, 15000, 60000]

let port = null
let retryIndex = 0
let retryTimer = null

function log(message, level = "info") {
  console[level](`[byko] ${message}`)
}

function scheduleRetry() {
  const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)]
  retryIndex += 1
  clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, delay)
}

function connect() {
  if (port) return
  clearTimeout(retryTimer)
  retryTimer = null

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  } catch (error) {
    port = null
    log(`connexion impossible : ${error.message}`, "warn")
    scheduleRetry()
    return
  }

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return
    if (message.type === "ping") {
      port.postMessage({ type: "pong", id: message.id })
      return
    }
    log(`message inattendu de BYKO : ${String(message.type)}`, "warn")
  })

  port.onDisconnect.addListener(() => {
    const detail = chrome.runtime.lastError ? chrome.runtime.lastError.message : "canal fermé"
    port = null
    log(`déconnecté de BYKO (${detail})`, "warn")
    scheduleRetry()
  })

  retryIndex = 0
  port.postMessage({ type: "hello", extensionVersion: chrome.runtime.getManifest().version })
  log("connecté à BYKO")
}

// L'extension doit parler en premier : aucun processus externe ne peut réveiller
// un service worker endormi (docs/ipc/browser-automation.md §4.2). On se
// reconnecte donc au démarrage du profil, à l'installation, et à chaque
// démarrage du service worker.
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
connect()
