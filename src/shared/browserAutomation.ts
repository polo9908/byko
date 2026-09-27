/**
 * Contrat du pont d'automatisation navigateur (voir docs/ipc/browser-automation.md).
 *
 * Phase ② : le pont seul — aucune recette, aucun secret, et rien n'est exposé
 * au renderer. Ce fichier ne décrit que ce qui circule entre l'extension (par
 * le helper natif) et le processus main.
 */

/** État du pont, du point de vue du processus main. */
export type BrowserAutomationBridgeState = "stopped" | "listening" | "connected"

export interface BrowserAutomationBridgeStatus {
  state: BrowserAutomationBridgeState
  /** Version annoncée par l'extension à la connexion. `null` tant qu'aucun `hello` n'est arrivé. */
  extensionVersion: string | null
  /** Durée du dernier aller-retour mesuré, en millisecondes. */
  lastRoundTripMs: number | null
}

/**
 * Messages relayés tels quels par le helper natif, dans les deux sens. Aucun ne
 * transporte de secret ni ne nomme une page : l'automatisation n'existe pas
 * encore à ce stade.
 */
export type BridgeMessage =
  | { type: "hello"; extensionVersion: string }
  | { type: "ping"; id: string; sentAt: number }
  | { type: "pong"; id: string }
  | { type: "log"; level: "info" | "warn"; message: string }

/**
 * Nom du manifeste hôte de messagerie native. Il est écrit par
 * `scripts/install-native-host.mjs` et appelé par l'extension : les deux
 * doivent utiliser exactement cette valeur.
 */
export const NATIVE_HOST_NAME = "com.byko.browser_automation"

/** Au-delà de ce délai, un aller-retour est considéré comme perdu. */
export const BRIDGE_PING_TIMEOUT_MS = 5000
