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

  // La console Google est bâtie sur des composants web : sans descendre dans les
  // shadow roots, on ne relève que la coquille (barre de navigation, recherche)
  // et on croit qu'une page est vide alors que son formulaire est à l'intérieur
  // d'un composant.
  const roots = [document]
  for (let index = 0; index < roots.length && roots.length < 40; index += 1) {
    for (const element of roots[index].querySelectorAll("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot)
    }
  }

  for (const root of roots) {
    if (nodes.length >= MAX_NODES) break
    for (const element of root.querySelectorAll(CANDIDATES)) {
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
        shadow: root !== document,
        attributes,
      })
    }
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

/**
 * Observation de la page, pour le pilotage par IA.
 *
 * Ne transmet **jamais** la valeur d'un champ ni le texte libre de la page : que
 * des éléments, avec une référence éphémère. Les éléments eux-mêmes sont gardés
 * dans un tableau que `performAction` retrouvera — le modèle ne manipule jamais
 * de sélecteur, seulement une référence qu'il a vue.
 *
 * Doit rester autonome : chrome.scripting sérialise cette fonction.
 */
function observePage(maxElements) {
  const KEEP_ATTRIBUTES = [
    "id",
    "role",
    "aria-label",
    "aria-expanded",
    "aria-haspopup",
    "aria-checked",
    "name",
    "type",
    "placeholder",
    "jsname",
    "title",
    "data-testid",
  ]
  const CANDIDATES =
    "a,button,input,select,textarea,summary,label,[role],[contenteditable=true],[jsname],[aria-label]"

  const roots = [document]
  for (let index = 0; index < roots.length && roots.length < 40; index += 1) {
    for (const element of roots[index].querySelectorAll("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot)
    }
  }

  const refs = []
  const elements = []
  for (const root of roots) {
    for (const element of root.querySelectorAll(CANDIDATES)) {
      if (elements.length >= maxElements) break
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      if (element.getAttribute("aria-hidden") === "true") continue

      const attributes = {}
      for (const name of KEEP_ATTRIBUTES) {
        const value = element.getAttribute(name)
        if (typeof value === "string" && value !== "") attributes[name] = value.slice(0, 120)
      }

      const tag = element.tagName.toLowerCase()
      const controls = tag === "input" || tag === "textarea" || tag === "select"
      const ownText = controls ? "" : (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80)
      const ref = `e${elements.length}`
      refs.push(element)
      elements.push({
        ref,
        tag,
        role: attributes.role || null,
        name: attributes["aria-label"] || ownText || attributes.placeholder || null,
        shadow: root !== document,
        attributes,
      })
    }
  }

  globalThis.__bykoRefs = refs
  return elements
}

/**
 * Exécute une action décidée par le modèle, sur un élément **déjà observé**.
 * Le modèle ne fournit qu'une référence ; il ne peut donc pas viser autre chose
 * que ce qu'il a vu.
 */
function performAction(action) {
  if (action.kind === "wait") return { ok: true }

  const refs = globalThis.__bykoRefs || []
  const index = Number(String(action.ref || "").slice(1))
  const element = refs[index]
  if (!element) {
    return { ok: false, detail: `référence « ${action.ref} » inconnue (la page a-t-elle changé ?)` }
  }

  try {
    element.scrollIntoView({ block: "center", inline: "nearest" })
  } catch {
    // Un élément non défilable n'empêche pas d'agir.
  }

  if (action.kind === "click") {
    // La console écoute des événements de souris : un simple .click() ne suffit
    // pas toujours sur ses composants.
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    element.click()
    return { ok: true }
  }

  if (action.kind === "fill") {
    element.focus()
    // Les champs contrôlés n'obéissent pas à une affectation directe de .value :
    // il faut passer par le setter natif, puis signaler la saisie.
    const prototype =
      element.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : element.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
    if (descriptor && descriptor.set) descriptor.set.call(element, action.value)
    else element.value = action.value
    element.dispatchEvent(new Event("input", { bubbles: true }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true }
  }

  return { ok: false, detail: `action inconnue : ${String(action.kind)}` }
}

/**
 * Lecture des identifiants, **hors de la boucle IA**.
 *
 * C'est le seul endroit qui lit la valeur de champs, et il ne parle qu'à BYKO :
 * jamais au modèle. Il tourne après que l'IA a rendu la main, précisément pour
 * qu'aucune page affichant un secret ne soit jamais observée par une IA.
 */
function readCredentials() {
  const roots = [document]
  for (let index = 0; index < roots.length && roots.length < 40; index += 1) {
    for (const element of roots[index].querySelectorAll("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot)
    }
  }

  const candidates = []
  for (const root of roots) {
    for (const element of root.querySelectorAll("input, textarea, [role=textbox], code, pre")) {
      const raw = typeof element.value === "string" && element.value !== "" ? element.value : element.innerText
      const text = typeof raw === "string" ? raw.trim() : ""
      if (text !== "" && text.length < 300) candidates.push(text)
    }
  }

  const clientId = candidates.find((value) => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(value)) || null
  const clientSecret = candidates.find((value) => /^GOCSPX-[A-Za-z0-9_-]+$/.test(value)) || null
  return { clientId, clientSecret }
}

/** Retrouve l'onglet ouvert sur un préfixe d'URL, ou rend `null`. */
async function findTab(urlPrefix) {
  const [tab] = await chrome.tabs.query({ url: `${urlPrefix}*` })
  return tab && typeof tab.id === "number" ? tab : null
}

/** Injecte une fonction dans l'onglet visé et rend son résultat. */
async function inject(tabId, func, args) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
  return injection ? injection.result : undefined
}

async function handleObserve(message) {
  const urlPrefix = String(message.urlPrefix || "")
  try {
    const tab = await findTab(urlPrefix)
    if (!tab) {
      port.postMessage({
        type: "observeFailed",
        requestId: message.requestId,
        reason: `aucun onglet ouvert sur ${urlPrefix}`,
      })
      return
    }
    const elements = (await inject(tab.id, observePage, [message.maxElements || 250])) || []
    port.postMessage({
      type: "observation",
      requestId: message.requestId,
      url: tab.url || urlPrefix,
      elements,
    })
  } catch (error) {
    port.postMessage({
      type: "observeFailed",
      requestId: message.requestId,
      reason: error && error.message ? error.message : String(error),
    })
  }
}

async function handleAct(message) {
  try {
    const tab = await findTab(message.urlPrefix)
    if (!tab) {
      port.postMessage({ type: "actResult", requestId: message.requestId, ok: false, detail: "onglet disparu" })
      return
    }
    const result = (await inject(tab.id, performAction, [message.action])) || { ok: false, detail: "sans réponse" }
    port.postMessage({ type: "actResult", requestId: message.requestId, ok: result.ok, detail: result.detail })
  } catch (error) {
    port.postMessage({
      type: "actResult",
      requestId: message.requestId,
      ok: false,
      detail: error && error.message ? error.message : String(error),
    })
  }
}

async function handleCaptureCredentials(message) {
  try {
    const tab = await findTab(message.urlPrefix)
    if (!tab) {
      port.postMessage({ type: "credentials", requestId: message.requestId, clientId: null, clientSecret: null })
      return
    }
    const found = (await inject(tab.id, readCredentials, [])) || { clientId: null, clientSecret: null }
    port.postMessage({
      type: "credentials",
      requestId: message.requestId,
      clientId: found.clientId,
      clientSecret: found.clientSecret,
    })
  } catch {
    port.postMessage({ type: "credentials", requestId: message.requestId, clientId: null, clientSecret: null })
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
    if (message.type === "observe") {
      void handleObserve(message)
      return
    }
    if (message.type === "act") {
      void handleAct(message)
      return
    }
    if (message.type === "captureCredentials") {
      void handleCaptureCredentials(message)
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
