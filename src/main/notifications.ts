import { app, BrowserWindow, screen } from "electron"
import { createHash } from "crypto"
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TARGETS,
  NOTIFICATION_DURATIONS,
  NOTIFICATION_TITLE_MAX,
  formatDuration,
} from "../shared/notifications"
import type {
  NotificationDuration,
  NotificationPayload,
  NotificationResult,
  NotificationTarget,
} from "../shared/notifications"

/**
 * Notifications en bas à droite de l'écran quand l'app n'est pas au premier plan.
 *
 * Les notifications natives de l'OS ne laissent pas choisir leur durée : on affiche donc une petite
 * fenêtre à nous, qui reste le temps demandé (accessibilité). La fenêtre est autonome : pas de
 * preload, sandbox + isolation, aucune navigation autorisée. Un clic la ferme : un unique script en ligne (autorisé
 * par son empreinte dans la CSP, rien d'autre ne peut s'exécuter) change le titre de la page, main l'écoute
 * (`page-title-updated`). Texte échappé et borné ici, jamais interprété.
 */

const WIDTH = 360
const MIN_HEIGHT = 72
const LINE_HEIGHT = 18
const CHARS_PER_LINE = 40
const MARGIN = 16
const MAX_VISIBLE = 3

interface Toast {
  target: NotificationTarget
  height: number
  window: BrowserWindow
  timer: NodeJS.Timeout
}

const toasts: Toast[] = []

/** Branché par index.ts : amène la fenêtre de BYKO au premier plan et la dirige vers la page liée à la notification. */
let openHandler: ((target: NotificationTarget) => void) | null = null

export function setOpenHandler(handler: (target: NotificationTarget) => void): void {
  openHandler = handler
}

export function isToast(window: BrowserWindow): boolean {
  return toasts.some((toast) => toast.window === window)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const DISMISS_SCRIPT = "document.addEventListener('click',function(){document.title='byko-dismiss'})"
const DISMISS_SCRIPT_HASH = createHash("sha256").update(DISMISS_SCRIPT).digest("base64")

/** Hauteur suivant la longueur du texte (jusqu'à 240 caractères) : rien n'est coupé. */
function toastHeight(payload: NotificationPayload): number {
  const lines = Math.ceil(payload.body.length / CHARS_PER_LINE)
  return MIN_HEIGHT + Math.max(0, lines - 1) * LINE_HEIGHT + (payload.title.length > 34 ? LINE_HEIGHT : 0)
}

function buildHtml(payload: NotificationPayload): string {
  const high = payload.highContrast === true
  const animate = payload.reduceMotion !== true
  const colors = high
    ? { bg: "#ffffff", text: "#000000", muted: "#222222", border: "#000000", bar: "#000000" }
    : { bg: "#ffffff", text: "#1d1d1f", muted: "#736b61", border: "rgba(29,29,31,.12)", bar: "#1d1d1f" }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${DISMISS_SCRIPT_HASH}'">
<style>
html,body{margin:0;height:100%;background:transparent;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
a{display:block;box-sizing:border-box;height:calc(100% - 8px);margin:4px;padding:14px 16px 18px;border-radius:16px;background:${colors.bg};color:${colors.text};text-decoration:none;border:${high ? 2 : 1}px solid ${colors.border};box-shadow:0 8px 28px rgba(29,29,31,.22);position:relative;overflow:hidden;cursor:pointer}
b{display:block;font-size:14px;font-weight:600;margin-bottom:3px}
span{display:block;font-size:13px;line-height:1.35;color:${colors.muted}}
i{position:absolute;left:0;bottom:0;height:4px;width:100%;background:${colors.bar};transform-origin:left;${animate ? `animation:bar ${payload.durationSeconds}s linear forwards` : "opacity:.35"}}
@keyframes bar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
</style></head><body><a><b>${escapeHtml(payload.title)}</b><span>${escapeHtml(payload.body)}</span><i></i></a><script>${DISMISS_SCRIPT}</script></body></html>`
}

function layout(): void {
  const area = screen.getPrimaryDisplay().workArea
  let bottom = area.y + area.height - MARGIN + 8
  for (const toast of toasts) {
    bottom -= toast.height + 8
    if (toast.window.isDestroyed()) continue
    toast.window.setBounds({ x: area.x + area.width - WIDTH - MARGIN, y: bottom, width: WIDTH, height: toast.height })
  }
}

function dismiss(toast: Toast): void {
  clearTimeout(toast.timer)
  const index = toasts.indexOf(toast)
  if (index !== -1) toasts.splice(index, 1)
  if (!toast.window.isDestroyed()) toast.window.destroy()
  layout()
}

export function closeAll(): void {
  for (const toast of [...toasts]) dismiss(toast)
}

function display(payload: NotificationPayload): void {
  while (toasts.length >= MAX_VISIBLE) dismiss(toasts[0])

  const height = toastHeight(payload)
  const window = new BrowserWindow({
    width: WIDTH,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  })
  const toast: Toast = { target: payload.target ?? "day", height, window, timer: setTimeout(() => dismiss(toast), payload.durationSeconds * 1000) }
  toasts.push(toast)

  // macOS : sans `visibleOnFullScreen`, le toast reste invisible au-dessus d'une app en plein écran.
  window.setAlwaysOnTop(true, "screen-saver")
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  window.webContents.on("page-title-updated", (event, title) => {
    event.preventDefault()
    if (title !== "byko-dismiss") return
    dismiss(toast)
    openHandler?.(toast.target)
  })
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.showInactive()
  })
  layout()
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(payload))}`)
}

/** Une fenêtre de l'app (hors toasts) est-elle au premier plan ? */
function appHasFocus(): boolean {
  return BrowserWindow.getAllWindows().some(
    (window) => window.isFocused() && !toasts.some((toast) => toast.window === window),
  )
}

export function show(payload: NotificationPayload): NotificationResult {
  if (appHasFocus()) return { shown: false }
  display(payload)
  return { shown: true }
}

/** Bouton « Tester » des Réglages : s'affiche même si l'app est au premier plan. */
export function test(durationSeconds: NotificationDuration, options: { highContrast: boolean; reduceMotion: boolean }): NotificationResult {
  display({
    title: "BYKO · Notification de test",
    body: `Cette notification reste affichée ${formatDuration(durationSeconds)}. Cliquez dessus pour ouvrir BYKO.`,
    durationSeconds,
    target: "settings-accessibility",
    ...options,
  })
  return { shown: true }
}

/** Validation des paramètres IPC (`unknown` → payload) : le renderer ne choisit ni URL, ni HTML, ni position. */
export function assertDuration(value: unknown): NotificationDuration {
  const found = NOTIFICATION_DURATIONS.find((duration) => duration === value)
  if (found === undefined) {
    throw new Error(`Paramètre "durationSeconds" invalide : ${NOTIFICATION_DURATIONS.join(", ")} attendus.`)
  }
  return found
}

function assertTarget(value: unknown): NotificationTarget {
  if (value === undefined) return "day"
  const found = NOTIFICATION_TARGETS.find((target) => target === value)
  if (found === undefined) {
    throw new Error(`Paramètre "target" invalide : ${NOTIFICATION_TARGETS.join(", ")} attendus.`)
  }
  return found
}

function assertText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Paramètre "${name}" invalide : une chaîne non vide est attendue.`)
  }
  return value.trim().slice(0, max)
}

function assertOptionalBoolean(value: unknown, name: string): boolean {
  if (value === undefined) return false
  if (typeof value !== "boolean") throw new Error(`Paramètre "${name}" invalide : un booléen est attendu.`)
  return value
}

export function assertPayload(value: unknown): NotificationPayload {
  if (typeof value !== "object" || value === null) throw new Error("Notification invalide : un objet est attendu.")
  const record = value as Record<string, unknown>
  return {
    title: assertText(record.title, "title", NOTIFICATION_TITLE_MAX),
    body: assertText(record.body, "body", NOTIFICATION_BODY_MAX),
    durationSeconds: assertDuration(record.durationSeconds),
    target: assertTarget(record.target),
    highContrast: assertOptionalBoolean(record.highContrast, "highContrast"),
    reduceMotion: assertOptionalBoolean(record.reduceMotion, "reduceMotion"),
  }
}

export function assertTestOptions(value: unknown): { highContrast: boolean; reduceMotion: boolean } {
  if (value !== undefined && (typeof value !== "object" || value === null)) {
    throw new Error("Options invalides : un objet est attendu.")
  }
  const record = (value ?? {}) as Record<string, unknown>
  return {
    highContrast: assertOptionalBoolean(record.highContrast, "highContrast"),
    reduceMotion: assertOptionalBoolean(record.reduceMotion, "reduceMotion"),
  }
}

// Les toasts ne doivent jamais retenir l'app en vie : quand il ne reste qu'eux, on les ferme.
app.on("browser-window-created", (_event, window) => {
  window.on("closed", () => {
    if (BrowserWindow.getAllWindows().every((other) => toasts.some((toast) => toast.window === other))) closeAll()
  })
})
app.on("before-quit", closeAll)
