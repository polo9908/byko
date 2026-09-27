/**
 * Contrat du pont d'automatisation navigateur (voir docs/ipc/browser-automation.md).
 *
 * Deux étages cohabitent ici :
 * - le **pont** (phase ②) : savoir si l'extension est joignable, mesurer un aller-retour ;
 * - la **capture** (phase ③) : décrire une recette, la faire exécuter, récupérer ce qu'elle
 *   ramasse, puis remettre ces valeurs au connecteur concerné.
 *
 * Aucune URL ne vit ici, et rien n'est exposé au renderer.
 */
import type { ConnectableConnectorId } from "./connectors"
import type { GoogleCalendarSetupPage } from "./googleCalendar"

/** État du pont, du point de vue du processus main. */
export type BrowserAutomationBridgeState = "stopped" | "listening" | "connected"

export interface BrowserAutomationBridgeStatus {
  state: BrowserAutomationBridgeState
  /** Version annoncée par l'extension à la connexion. `null` tant qu'aucun `hello` n'est arrivé. */
  extensionVersion: string | null
  /** Durée du dernier aller-retour mesuré, en millisecondes. */
  lastRoundTripMs: number | null
}

// ---------------------------------------------------------------------------
// Modèle de recette
// ---------------------------------------------------------------------------

/**
 * Pages qu'une recette a le droit d'ouvrir. Les URL correspondantes vivent côté
 * main uniquement, comme `SETUP_PAGE_URLS` : le renderer n'en connaît aucune.
 * Chaque nouveau connecteur ajoute ses pages ici en même temps que sa recette.
 */
export type AutomationPageId = GoogleCalendarSetupPage

/**
 * Liste blanche des recettes. Chaque connecteur ajoute la sienne ici — et une
 * par fournisseur pour l'IA, qui en compte six. Le renderer n'envoie qu'un
 * identifiant de cette liste, jamais une étape ni un sélecteur.
 */
export type AutomationRecipeId = "calendar:oauthClient"

/** Ce qu'une étape `read` ramasse. Chaque clé est préfixée par son connecteur. */
export type CaptureKey = "calendar.clientId" | "calendar.clientSecret"

/** D'où vient la valeur écrite dans un champ. */
export type FillValue =
  | { kind: "constant"; value: string }
  | { kind: "generated"; prefix: string }
  | { kind: "user"; label: string }

export type RecipeStep =
  | { action: "open"; page: AutomationPageId; description: string }
  | { action: "click"; selector: string; description: string }
  | { action: "fill"; selector: string; value: FillValue; description: string }
  | { action: "waitFor"; selector: string; timeoutMs: number; description: string }
  | { action: "read"; selector: string; capture: CaptureKey; description: string }
  | { action: "pause"; reason: "humanConsent"; description: string }

export interface AutomationRecipe {
  id: AutomationRecipeId
  connector: ConnectableConnectorId
  /** Origines sur lesquelles la recette a le droit d'agir, et rien d'autre. */
  origins: readonly string[]
  steps: readonly RecipeStep[]
}

/** Clés qu'une recette doit avoir ramassées pour que sa capture soit complète. */
export function requiredCaptureKeys(recipe: AutomationRecipe): CaptureKey[] {
  const keys: CaptureKey[] = []
  for (const step of recipe.steps) {
    if (step.action === "read") keys.push(step.capture)
  }
  return keys
}

// ---------------------------------------------------------------------------
// Protocole du pont
// ---------------------------------------------------------------------------

/** Messages relayés tels quels par le helper natif, dans les deux sens. */
export type BridgeMessage =
  | { type: "hello"; extensionVersion: string }
  | { type: "ping"; id: string; sentAt: number }
  | { type: "pong"; id: string }
  | { type: "log"; level: "info" | "warn"; message: string }
  // Phase ③ — exécution d'une recette. Le main envoie `run` et `cancel` ;
  // l'extension renvoie `step`, `capture` et `finished`.
  | { type: "run"; runId: string; recipe: AutomationRecipe }
  | { type: "cancel"; runId: string }
  | { type: "step"; runId: string; index: number; status: "ok" | "failed" | "waiting"; detail?: string }
  | { type: "capture"; runId: string; key: CaptureKey; value: string }
  | { type: "finished"; runId: string; outcome: "completed" | "paused" | "failed"; reason?: string }

/**
 * Nom du manifeste hôte de messagerie native. Il est écrit par
 * `scripts/install-native-host.mjs` et appelé par l'extension : les deux
 * doivent utiliser exactement cette valeur.
 */
export const NATIVE_HOST_NAME = "com.byko.browser_automation"

/** Au-delà de ce délai, un aller-retour est considéré comme perdu. */
export const BRIDGE_PING_TIMEOUT_MS = 5000

/** Au-delà de ce délai, une recette qui ne rend pas la main est déclarée en échec. */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000

/** État d'une exécution de recette, du point de vue du main. */
export type AutomationRunState =
  | "idle"
  | "running"
  | "awaiting-human"
  | "applying"
  | "done"
  | "failed"
  | "cancelled"

export interface AutomationRunStatus {
  state: AutomationRunState
  recipeId: AutomationRecipeId | null
  stepIndex: number | null
  stepCount: number
  /** Dernier libellé d'étape ou motif d'échec, affichable tel quel. */
  detail: string | null
}
