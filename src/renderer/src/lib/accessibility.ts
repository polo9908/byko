import { useCallback, useState } from "react"
import { NOTIFICATION_DEFAULT_DURATION, NOTIFICATION_DURATIONS } from "@shared/notifications"
import type { NotificationDuration } from "@shared/notifications"

/**
 * Préférences d'accessibilité (Réglages > Accessibilité). Purement visuelles et propres à l'appareil :
 * `localStorage` du renderer, comme les mémos (voir memos.ts). Jamais de secret ici.
 *
 * Application : attributs `data-a11y-*` sur <html> (styles : styles/accessibility.css), palette
 * (variables `--bcc-color-*` + filtre) posée en style inline, zoom de toute l'interface via
 * `window.api.display.setZoom` (zoom Chromium : la mise en page s'adapte, frise comprise).
 */

export type PaletteId = "standard" | "red-green" | "blue-yellow" | "grayscale" | "invert" | "warm"

export interface AccessibilityPrefs {
  /** Zoom de l'interface (1 = 100 %, 2 = 200 %). */
  scale: number
  palette: PaletteId
  highContrast: boolean
  boldText: boolean
  spacedText: boolean
  reduceTransparency: boolean
  reduceMotion: boolean
  strongFocus: boolean
  largeTargets: boolean
  ignoreRepeatedClicks: boolean
  notificationSeconds: NotificationDuration
}

export const ACCESSIBILITY_DEFAULTS: AccessibilityPrefs = {
  scale: 1,
  palette: "standard",
  highContrast: false,
  boldText: false,
  spacedText: false,
  reduceTransparency: false,
  reduceMotion: false,
  strongFocus: false,
  largeTargets: false,
  ignoreRepeatedClicks: false,
  notificationSeconds: NOTIFICATION_DEFAULT_DURATION,
}

export const SCALE_MIN = 0.8
export const SCALE_MAX = 2
export const SCALE_STEP = 0.1
export const SCALE_PRESETS = [1, 1.25, 1.5, 2]

export interface PaletteDefinition {
  id: PaletteId
  label: string
  hint: string
  /** Variables `--bcc-color-*` remplacées (le reste garde la valeur de tokens.css). */
  tokens: Record<string, string>
  /** Filtre CSS posé sur toute l'interface (niveaux de gris, inversion…). */
  filter?: string
}

export const DEFAULT_TOKENS = {
  "--bcc-color-bg": "#f4f1ec",
  "--bcc-color-surface": "#ffffff",
  "--bcc-color-text": "#1d1d1f",
  "--bcc-color-accent": "#0c66e4",
  "--bcc-color-success": "#1a7f37",
  "--bcc-color-danger": "#c0392b",
}

export const PALETTES: PaletteDefinition[] = [
  { id: "standard", label: "Standard", hint: "Couleurs d'origine de BYKO.", tokens: {} },
  {
    id: "red-green",
    label: "Rouge-vert",
    hint: "Protanopie, deutéranopie : bleu et orange à la place du vert et du rouge.",
    tokens: { "--bcc-color-success": "#0072b2", "--bcc-color-danger": "#d55e00" },
  },
  {
    id: "blue-yellow",
    label: "Bleu-jaune",
    hint: "Tritanopie : magenta et vert à la place du bleu.",
    tokens: { "--bcc-color-accent": "#c2185b", "--bcc-color-success": "#2e7d32", "--bcc-color-danger": "#8d3b00" },
  },
  {
    id: "grayscale",
    label: "Niveaux de gris",
    hint: "Achromatopsie, ou pour réduire la fatigue visuelle : plus aucune couleur.",
    tokens: {},
    filter: "grayscale(1)",
  },
  {
    id: "invert",
    label: "Sombre (inversion)",
    hint: "Photophobie : fond sombre, les couleurs gardent leur teinte.",
    tokens: {},
    filter: "invert(0.92) hue-rotate(180deg)",
  },
  {
    id: "warm",
    label: "Teinte chaude",
    hint: "Sensibilité à la lumière : moins de bleu, luminosité adoucie.",
    tokens: {},
    filter: "sepia(0.3) saturate(1.05) brightness(0.94)",
  },
]

const HIGH_CONTRAST_TOKENS: Record<string, string> = {
  "--bcc-color-text": "#000000",
  "--bcc-color-text-muted": "#3d3832",
  "--bcc-color-border": "rgba(0, 0, 0, 0.55)",
  "--bcc-color-accent": "#0848a8",
}

export function paletteById(id: PaletteId): PaletteDefinition {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0]
}

const STORAGE_KEY = "byko.accessibility"

const FLAGS = [
  "highContrast",
  "boldText",
  "spacedText",
  "reduceTransparency",
  "reduceMotion",
  "strongFocus",
  "largeTargets",
  "ignoreRepeatedClicks",
] as const

function sanitize(raw: unknown): AccessibilityPrefs {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  const next: AccessibilityPrefs = { ...ACCESSIBILITY_DEFAULTS }
  for (const key of FLAGS) if (typeof value[key] === "boolean") next[key] = value[key] as boolean
  if (typeof value.scale === "number" && Number.isFinite(value.scale)) {
    next.scale = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, value.scale)) * 100) / 100
  }
  const palette = PALETTES.find((entry) => entry.id === value.palette)
  // Ancien réglage « palette daltonisme » (avant les palettes) : rouge-vert.
  if (palette) next.palette = palette.id
  else if (value.colorblindPalette === true) next.palette = "red-green"
  const seconds = NOTIFICATION_DURATIONS.find((duration) => duration === value.notificationSeconds)
  if (seconds !== undefined) next.notificationSeconds = seconds
  return next
}

export function loadAccessibilityPrefs(): AccessibilityPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return sanitize(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...ACCESSIBILITY_DEFAULTS }
  }
}

let ignoreRepeatedClicks = false
let guardsInstalled = false

/** Anti-tremblements : un second clic sur le même élément dans la demi-seconde est ignoré. */
function installClickGuard(): void {
  if (guardsInstalled) return
  guardsInstalled = true
  let lastTarget: EventTarget | null = null
  let lastTime = 0
  document.addEventListener(
    "click",
    (event) => {
      if (!ignoreRepeatedClicks) return
      const now = event.timeStamp
      // Le contrôle visé, pas l'élément enfant précis (icône, texte…) : sinon un clic sur l'icône puis sur le bouton passerait.
      const target = event.target instanceof Element ? (event.target.closest('button, [role="button"], a, label') ?? event.target) : event.target
      if (target === lastTarget && now - lastTime < 500) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      lastTarget = target
      lastTime = now
    },
    true,
  )
}

function setFlag(root: HTMLElement, name: string, on: boolean): void {
  if (on) root.setAttribute(name, "")
  else root.removeAttribute(name)
}

export function applyAccessibilityPrefs(prefs: AccessibilityPrefs): void {
  const root = document.documentElement
  setFlag(root, "data-a11y-bold", prefs.boldText)
  setFlag(root, "data-a11y-spacing", prefs.spacedText)
  setFlag(root, "data-a11y-transparency", prefs.reduceTransparency)
  setFlag(root, "data-a11y-motion", prefs.reduceMotion)
  setFlag(root, "data-a11y-focus", prefs.strongFocus)
  setFlag(root, "data-a11y-targets", prefs.largeTargets)
  root.dataset.a11yPalette = prefs.palette

  const palette = paletteById(prefs.palette)
  const tokens = { ...(prefs.highContrast ? HIGH_CONTRAST_TOKENS : {}), ...palette.tokens }
  for (const name of [...Object.keys(HIGH_CONTRAST_TOKENS), ...Object.keys(DEFAULT_TOKENS)]) {
    if (tokens[name]) root.style.setProperty(name, tokens[name])
    else root.style.removeProperty(name)
  }
  root.style.filter = palette.filter ?? ""

  ignoreRepeatedClicks = prefs.ignoreRepeatedClicks
  installClickGuard()
  window.api?.display?.setZoom(prefs.scale)
}

export function saveAccessibilityPrefs(prefs: AccessibilityPrefs): void {
  applyAccessibilityPrefs(prefs)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Stockage indisponible : la préférence reste appliquée pour la session.
  }
}

/** À appeler avant le premier rendu (main.tsx). */
export function applyStoredAccessibilityPrefs(): void {
  applyAccessibilityPrefs(loadAccessibilityPrefs())
}

export function useAccessibilityPrefs(): {
  prefs: AccessibilityPrefs
  update: (patch: Partial<AccessibilityPrefs>) => void
  reset: () => void
} {
  const [prefs, setPrefs] = useState(loadAccessibilityPrefs)
  const update = useCallback((patch: Partial<AccessibilityPrefs>) => {
    const next = sanitize({ ...prefs, ...patch })
    saveAccessibilityPrefs(next)
    setPrefs(next)
  }, [prefs])
  const reset = useCallback(() => {
    const next = { ...ACCESSIBILITY_DEFAULTS }
    saveAccessibilityPrefs(next)
    setPrefs(next)
  }, [])
  return { prefs, update, reset }
}
