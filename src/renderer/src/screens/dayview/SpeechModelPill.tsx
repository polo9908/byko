import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { prefersReducedMotion, spring, SPRINGS } from "@renderer/lib/motion"
import type { Spring } from "@renderer/lib/motion"
import { playSfx } from "@renderer/lib/sound"
import type { SpeechModelStatus } from "@shared/speech"
import "./speechmodelpill.css"

type View = "loading" | "error" | "ready"

/** En deçà, le modèle est déjà sur le disque : pas de pastille qui clignote pour un chargement instantané. */
const SHOW_AFTER_MS = 600
const READY_MS = 2200

/**
 * Pastille d'état du modèle de transcription local : barre de progression pendant son téléchargement
 * (une seule fois, plusieurs centaines de Mo), « prêt » un instant à la fin, ou l'échec avec un bouton
 * pour réessayer. La barre avance en ressort, la pastille entre et sort de même.
 */
function SpeechModelPill(): React.JSX.Element | null {
  const [status, setStatus] = useState<SpeechModelStatus>({ state: "idle", progress: 0 })
  const [view, setView] = useState<View | null>(null)
  const [mounted, setMounted] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const presenceRef = useRef<Spring | null>(null)
  const barSpringRef = useRef<Spring | null>(null)
  const shownRef = useRef(false)

  useEffect(() => {
    let alive = true
    window.api.speech
      .getStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined)
    const off = window.api.speech.onStatus((s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  // Quelle vue afficher, et quand.
  useEffect(() => {
    if (status.state === "loading") {
      const timer = setTimeout(() => {
        shownRef.current = true
        setView("loading")
      }, SHOW_AFTER_MS)
      return () => clearTimeout(timer)
    }
    if (status.state === "error") {
      shownRef.current = true
      setView("error")
      return undefined
    }
    if (status.state === "ready" && shownRef.current) {
      shownRef.current = false
      setView("ready")
      playSfx("saved")
      const timer = setTimeout(() => setView(null), READY_MS)
      return () => clearTimeout(timer)
    }
    setView(null)
    return undefined
  }, [status.state])

  // Entrée / sortie en ressort.
  useLayoutEffect(() => {
    const visible = view !== null
    if (visible) setMounted(true)
    const pill = pillRef.current
    if (!pill) return
    const paint = (p: number): void => {
      pill.style.opacity = String(Math.max(0, Math.min(1, p * 1.6)))
      pill.style.translate = `0 ${((1 - p) * 18).toFixed(2)}px`
      pill.style.scale = (0.9 + 0.1 * p).toFixed(4)
      if (p === 0 && presenceRef.current?.target === 0) setMounted(false)
    }
    if (prefersReducedMotion()) {
      paint(visible ? 1 : 0)
      return
    }
    if (!presenceRef.current) {
      paint(0)
      presenceRef.current = spring(0, visible ? 1 : 0, { stiffness: 260, damping: 17 }, paint)
      return
    }
    presenceRef.current.retarget(visible ? 1 : 0)
  }, [view, mounted])

  // La barre avance en ressort vers la progression réelle.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const target = view === "ready" ? 1 : status.progress
    const paint = (p: number): void => {
      bar.style.scale = `${Math.max(0, Math.min(1.02, p)).toFixed(4)} 1`
    }
    if (!barSpringRef.current || prefersReducedMotion()) {
      paint(target)
      barSpringRef.current = spring(target, target, SPRINGS.gentle, paint)
      return
    }
    barSpringRef.current.retarget(target)
  }, [status.progress, view, mounted])

  useEffect(() => {
    return () => {
      presenceRef.current?.stop()
      barSpringRef.current?.stop()
    }
  }, [])

  if (!mounted && view === null) return null

  const percent = Math.round((view === "ready" ? 1 : status.progress) * 100)
  return (
    <div
      ref={pillRef}
      className={`speech-pill speech-pill--${view ?? "ready"}`}
      role="status"
      aria-live="polite"
    >
      {view === "error" ? (
        <>
          <span className="speech-pill-text">
            {status.error ?? "Modèle de transcription indisponible."}
          </span>
          <button
            type="button"
            className="speech-pill-retry"
            onClick={() => void window.api.speech.prepare().catch(() => undefined)}
          >
            Réessayer
          </button>
        </>
      ) : (
        <>
          <div className="speech-pill-row">
            <span className="speech-pill-text">
              {view === "ready"
                ? "Transcription prête"
                : "Préparation de la transcription (une seule fois)"}
            </span>
            <span className="speech-pill-percent">{percent} %</span>
          </div>
          <div className="speech-pill-track" aria-hidden="true">
            <div ref={barRef} className="speech-pill-fill" />
          </div>
        </>
      )}
    </div>
  )
}

export default SpeechModelPill
