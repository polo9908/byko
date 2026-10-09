import { useState } from "react"
import { NOTIFICATION_DURATIONS, formatDuration } from "@shared/notifications"
import {
  DEFAULT_TOKENS,
  PALETTES,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_PRESETS,
  SCALE_STEP,
  useAccessibilityPrefs,
} from "@renderer/lib/accessibility"
import type { AccessibilityPrefs, PaletteDefinition } from "@renderer/lib/accessibility"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import Switch from "./Switch"

type FlagKey =
  | "highContrast"
  | "boldText"
  | "spacedText"
  | "reduceTransparency"
  | "reduceMotion"
  | "strongFocus"
  | "largeTargets"
  | "ignoreRepeatedClicks"

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const

const ICONS = {
  vision: (
    <svg {...SVG_PROPS}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  reading: (
    <svg {...SVG_PROPS}>
      <path d="M4 20l5-14 5 14M6 15h6M16 8h4M16 12h4M16 16h4" />
    </svg>
  ),
  motion: (
    <svg {...SVG_PROPS}>
      <path d="M2 9c3-3 5 3 8 0s5 3 8 0M2 15c3-3 5 3 8 0s5 3 8 0" />
    </svg>
  ),
  motor: (
    <svg {...SVG_PROPS}>
      <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V3.5a1.5 1.5 0 0 1 3 0V10M14 10V5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7-3 0-4.5-2-6-5l-1.5-3a1.5 1.5 0 0 1 2.5-1.5L8 13" />
    </svg>
  ),
  notifications: (
    <svg {...SVG_PROPS}>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0" />
    </svg>
  ),
}

interface Toggle {
  key: FlagKey
  name: string
  help: string
}

interface Theme {
  id: string
  title: string
  subtitle: string
  color: string
  icon: React.JSX.Element
}

const THEMES: Record<"vision" | "reading" | "motion" | "motor" | "notifications", Theme> = {
  vision: { id: "vision", title: "Vision", subtitle: "Basse vision, daltonisme, sensibilité à la lumière", color: "#0a84ff", icon: ICONS.vision },
  reading: { id: "reading", title: "Lecture", subtitle: "Dyslexie, fatigue visuelle", color: "#ff9f0a", icon: ICONS.reading },
  motion: { id: "motion", title: "Mouvement", subtitle: "Vertiges, sensibilité aux animations", color: "#30b05a", icon: ICONS.motion },
  motor: { id: "motor", title: "Motricité", subtitle: "Parkinson, tremblements, précision réduite", color: "#8e5cf0", icon: ICONS.motor },
  notifications: { id: "notifications", title: "Notifications", subtitle: "Temps de lecture et alertes", color: "#ff453a", icon: ICONS.notifications },
}

const VISION_TOGGLES: Toggle[] = [
  { key: "highContrast", name: "Contraste élevé", help: "Textes plus foncés, bordures renforcées." },
  { key: "boldText", name: "Texte en gras", help: "Épaissit tous les textes." },
  { key: "reduceTransparency", name: "Réduire la transparence", help: "Supprime les flous et effets de verre." },
]
const READING_TOGGLES: Toggle[] = [
  { key: "spacedText", name: "Texte plus espacé", help: "Lettres et mots plus aérés, plus faciles à suivre." },
]
const MOTION_TOGGLES: Toggle[] = [
  { key: "reduceMotion", name: "Réduire les animations", help: "Supprime transitions, ressorts et effets de goutte d'eau." },
]
const MOTOR_TOGGLES: Toggle[] = [
  { key: "largeTargets", name: "Grandes zones de clic", help: "Boutons d'au moins 44 px, plus faciles à viser." },
  { key: "ignoreRepeatedClicks", name: "Ignorer les clics répétés", help: "Un second clic au même endroit dans la demi-seconde est ignoré." },
  { key: "strongFocus", name: "Focus renforcé", help: "Contour épais et très visible lors de la navigation au clavier." },
]

function ThemeHeader({ theme }: { theme: Theme }): React.JSX.Element {
  return (
    <div className="settings-a11y-theme">
      <span className="settings-a11y-theme-icon" style={{ background: theme.color }}>
        {theme.icon}
      </span>
      <div>
        <h4 className="settings-a11y-theme-title">{theme.title}</h4>
        <p className="settings-a11y-theme-subtitle">{theme.subtitle}</p>
      </div>
    </div>
  )
}

function ToggleRow({
  toggle,
  prefs,
  onChange,
}: {
  toggle: Toggle
  prefs: AccessibilityPrefs
  onChange: (key: FlagKey, value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="settings-row settings-privacy-row">
      <div className="settings-row-info">
        <span className="settings-privacy-label" id={`settings-a11y-${toggle.key}-label`}>
          {toggle.name}
        </span>
        <span className="settings-row-subtitle" id={`settings-a11y-${toggle.key}-help`}>
          {toggle.help}
        </span>
      </div>
      <Switch
        checked={prefs[toggle.key]}
        onChange={(next) => onChange(toggle.key, next)}
        labelledBy={`settings-a11y-${toggle.key}-label`}
        describedBy={`settings-a11y-${toggle.key}-help`}
      />
    </div>
  )
}

/** Aperçu d'une palette : une mini-fenêtre avec les couleurs et le filtre réellement appliqués. */
function PalettePreview({ palette, active }: { palette: PaletteDefinition; active: boolean }): React.JSX.Element {
  const tokens = { ...DEFAULT_TOKENS, ...palette.tokens }
  return (
    <span
      className="settings-palette-preview"
      aria-hidden="true"
      style={{
        background: tokens["--bcc-color-bg"],
        color: tokens["--bcc-color-text"],
        // La palette active filtre déjà toute l'interface, aperçu compris : on ne la double pas.
        filter: active ? undefined : palette.filter,
      }}
    >
      <span className="settings-palette-card" style={{ background: tokens["--bcc-color-surface"] }}>
        <span className="settings-palette-line" style={{ background: tokens["--bcc-color-text"] }} />
        <span className="settings-palette-line settings-palette-line--short" style={{ background: tokens["--bcc-color-text"] }} />
        <span className="settings-palette-chips">
          <i style={{ background: tokens["--bcc-color-accent"] }} />
          <i style={{ background: tokens["--bcc-color-success"] }} />
          <i style={{ background: tokens["--bcc-color-danger"] }} />
        </span>
      </span>
    </span>
  )
}

/** Préférences visuelles propres à l'appareil, appliquées immédiatement (voir lib/accessibility.ts). */
function AccessibilitySection(): React.JSX.Element {
  const { prefs, update, reset } = useAccessibilityPrefs()
  const [testError, setTestError] = useState<string | null>(null)
  const setFlag = (key: FlagKey, value: boolean): void => update({ [key]: value })

  async function handleTest(): Promise<void> {
    setTestError(null)
    try {
      await window.api.notifications.test(prefs.notificationSeconds, {
        highContrast: prefs.highContrast,
        reduceMotion: prefs.reduceMotion,
      })
    } catch (err) {
      setTestError(cleanIpcErrorMessage(err))
    }
  }

  return (
    <>
      <ThemeHeader theme={THEMES.vision} />
      <div className="settings-range-row">
        <div className="settings-range-head">
          <label className="settings-privacy-label" htmlFor="settings-a11y-scale">
            Zoom de l&apos;interface
          </label>
          <output htmlFor="settings-a11y-scale" className="settings-detail-hint">
            {Math.round(prefs.scale * 100)} %
          </output>
        </div>
        <input
          id="settings-a11y-scale"
          type="range"
          className="settings-range"
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={SCALE_STEP}
          value={prefs.scale}
          aria-describedby="settings-a11y-scale-help"
          onChange={(event) => update({ scale: Number(event.target.value) })}
        />
        <div className="settings-chip-row">
          {SCALE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="settings-chip"
              aria-pressed={Math.abs(prefs.scale - preset) < 0.01}
              onClick={() => update({ scale: preset })}
            >
              {Math.round(preset * 100)} %
            </button>
          ))}
        </div>
        <p className="settings-detail-hint" id="settings-a11y-scale-help">
          Agrandit tout : textes, frise chronologique, boutons. La mise en page s&apos;adapte à la largeur de la fenêtre.
        </p>
      </div>

      <p className="settings-a11y-subtitle" id="settings-a11y-palette-label">
        Couleurs
      </p>
      <div className="settings-palettes" role="radiogroup" aria-labelledby="settings-a11y-palette-label">
        {PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            role="radio"
            aria-checked={prefs.palette === palette.id}
            className="settings-palette"
            onClick={() => update({ palette: palette.id })}
          >
            <PalettePreview palette={palette} active={prefs.palette === palette.id} />
            <span className="settings-palette-name">{palette.label}</span>
            <span className="settings-palette-hint">{palette.hint}</span>
          </button>
        ))}
      </div>
      {VISION_TOGGLES.map((toggle) => (
        <ToggleRow key={toggle.key} toggle={toggle} prefs={prefs} onChange={setFlag} />
      ))}

      <ThemeHeader theme={THEMES.reading} />
      {READING_TOGGLES.map((toggle) => (
        <ToggleRow key={toggle.key} toggle={toggle} prefs={prefs} onChange={setFlag} />
      ))}

      <ThemeHeader theme={THEMES.motion} />
      {MOTION_TOGGLES.map((toggle) => (
        <ToggleRow key={toggle.key} toggle={toggle} prefs={prefs} onChange={setFlag} />
      ))}

      <ThemeHeader theme={THEMES.motor} />
      {MOTOR_TOGGLES.map((toggle) => (
        <ToggleRow key={toggle.key} toggle={toggle} prefs={prefs} onChange={setFlag} />
      ))}

      <ThemeHeader theme={THEMES.notifications} />
      <div className="settings-range-row">
        <p className="settings-privacy-label" id="settings-a11y-notif-label">
          Durée d&apos;affichage d&apos;une notification
        </p>
        <div className="settings-chip-row" role="radiogroup" aria-labelledby="settings-a11y-notif-label">
          {NOTIFICATION_DURATIONS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              role="radio"
              aria-checked={prefs.notificationSeconds === seconds}
              className="settings-chip"
              onClick={() => update({ notificationSeconds: seconds })}
            >
              {formatDuration(seconds)}
            </button>
          ))}
        </div>
        <div className="settings-toast-preview" aria-hidden="true">
          <b>Byko · Point d&apos;équipe</b>
          <span>Votre réunion commence dans 5 minutes.</span>
          {/* `key` : la barre repart de zéro à chaque changement de durée. */}
          <i key={prefs.notificationSeconds} style={{ animationDuration: `${prefs.notificationSeconds}s` }} />
        </div>
        <p className="settings-detail-hint">
          Quand Byko n&apos;est pas au premier plan, l&apos;alerte apparaît en bas à droite de l&apos;écran et y reste
          ce temps-là. Un clic la ferme.
        </p>
        <button type="button" className="settings-connect-button" onClick={() => void handleTest()}>
          Tester la notification
        </button>
        {testError && (
          <p className="settings-detail-error" role="alert">
            {testError}
          </p>
        )}
      </div>

      <div className="settings-row">
        <button type="button" className="settings-connect-button" onClick={reset}>
          Rétablir les valeurs par défaut
        </button>
      </div>
    </>
  )
}

export default AccessibilitySection
