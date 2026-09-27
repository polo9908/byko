/**
 * Pont côté navigateur.
 *
 * Deux rôles, et rien d'autre :
 * - ouvrir le canal vers BYKO et répondre aux pings (phase ②) ;
 * - relever la structure d'un onglet en liste blanche à la demande de BYKO, pour
 *   écrire les sélecteurs des recettes (phase ③, outil de maintenance).
 *
 * **Aucune valeur de champ n'est jamais lue ni transmise.** Une page de console
 * affiche des secrets ; la seule façon sûre de ne pas les collecter est de ne
 * jamais lire les valeurs. Voir `collectStructure` ci-dessous.
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

/**
 * Relevé de la structure d'une page. Exécuté **dans la page**.
 *
 * Contraintes : cette fonction est sérialisée par chrome.scripting, elle ne doit
 * donc rien capturer de son environnement. Et elle ne lit jamais `.value` d'un
 * champ — seulement des attributs sur liste blanche, et du texte visible tronqué
 * pour les éléments qui en portent.
 */
function collectStructure() {
  const KEEP_ATTRIBUTES = [
    "id",
    "role",
    "aria-label",
    "aria-labelledby",
    "aria-expanded",
    "aria-haspopup",
    "aria-checked",
    "name",
    "type",
    "placeholder",
    "for",
    "jsname",
    "title",
    "alt",
    "data-testid",
    "data-id",
  ]
  const CANDIDATES =
    "a,button,input,select,textarea,summary,label,[role],[contenteditable=true],[jsname],[aria-label]"
  const MAX_NODES = 400
  const MAX_TEXT = 80
  const MAX_ATTRIBUTE = 120

  const nodes = []
  for (const element of document.querySelectorAll(CANDIDATES)) {
    if (nodes.length >= MAX_NODES) break

    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    if (element.getAttribute("aria-hidden") === "true") continue

    const attributes = {}
    for (const name of KEEP_ATTRIBUTES) {
      const value = element.getAttribute(name)
      if (typeof value === "string" && value !== "") attributes[name] = value.slice(0, MAX_ATTRIBUTE)
    }

    const tag = element.tagName.toLowerCase()
    const controls = tag === "input" || tag === "textarea" || tag === "select"
    // Les champs n'ont pas de texte propre : seule leur étiquette est reprise,
    // jamais leur contenu.
    const ownText = controls ? "" : (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT)
    const label = attributes["aria-label"] || ownText || attributes.placeholder || ""

    nodes.push({
      tag,
      role: attributes.role || null,
      name: label || null,
      selector: proposeSelector(tag, attributes),
      attributes,
    })
  }

  function proposeSelector(tag, attributes) {
    if (attributes.id) return `#${attributes.id}`
    for (const name of ["data-testid", "jsname", "name", "aria-label"]) {
      const value = attributes[name]
      if (value && !value.includes('"')) return `${tag}[${name}="${value}"]`
    }
    return tag
  }

  return nodes
}

async function handleRecon(message) {
  const urlPrefix = String(message.urlPrefix || "")
  try {
    // Le préfixe vise une page précise si on le souhaite
    // (`…/projectcreate`), ce qui permet de relever plusieurs pages ouvertes.
    const [tab] = await chrome.tabs.query({ url: `${urlPrefix}*` })
    if (!tab || typeof tab.id !== "number") {
      port.postMessage({
        type: "reconFailed",
        requestId: message.requestId,
        reason: `aucun onglet ouvert sur ${urlPrefix}`,
      })
      return
    }
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectStructure,
    })
    port.postMessage({
      type: "reconResult",
      requestId: message.requestId,
      url: tab.url || urlPrefix,
      nodes: injection && injection.result ? injection.result : [],
    })
  } catch (error) {
    port.postMessage({
      type: "reconFailed",
      requestId: message.requestId,
      reason: error && error.message ? error.message : String(error),
    })
  }
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
    if (message.type === "recon") {
      void handleRecon(message)
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
