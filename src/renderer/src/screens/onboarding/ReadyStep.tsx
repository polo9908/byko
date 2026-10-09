import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { enter, impulse, pop, prefersReducedMotion, spring, SPRINGS, stagger } from "@renderer/lib/motion"
import { CheckIcon } from "./icons"
import { playSetupSound } from "@renderer/lib/sound"
import "./onboarding.css"

interface ReadyStepProps {
  onStart: () => void
}

/**
 * Écran de transition « C'est prêt. », fidèle au prototype : icône coche,
 * titre, message qui change une fois le chargement terminé, barre de
 * progression, bouton « Commencer ma journée ».
 *
 * Le nombre de tickets vient de Jira (E1, `jira:countOpenIssues`, comme dans
 * `DayView`). Le prototype ajoutait aussi « 5 décisions vous attendent » :
 * aucun moteur de décision n'existe dans ce projet (voir `JournalView`, qui
 * reste honnêtement vide pour la même raison), donc cette partie est omise
 * plutôt que remplacée par un chiffre inventé.
 */
function ReadyStep({ onStart }: ReadyStepProps): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [ticketCount, setTicketCount] = useState<number | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const checkRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // La coche éclot et se trace, le reste se pose en cascade, le tout au rythme du son d'entrée.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    stagger(Array.from(root.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el !== checkRef.current), 80, 260)
    if (checkRef.current) pop(checkRef.current, 0, 0.3)
    const shape = checkRef.current?.querySelector<SVGGeometryElement>("polyline")
    if (shape && !prefersReducedMotion()) {
      shape.setAttribute("pathLength", "1")
      shape.style.strokeDasharray = "1"
      shape.style.strokeDashoffset = "1"
      const t = setTimeout(() => {
        spring(1, 0, { stiffness: 200, damping: 18 }, (o) => {
          shape.style.strokeDashoffset = o <= 0.001 ? "0" : o.toFixed(3)
        })
      }, 160)
      return () => clearTimeout(t)
    }
    return undefined
  }, [])

  // La barre de lancement se remplit en ressort : 60 % puis 100 % avec un léger dépassement.
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const target = ready ? 100 : 60
    if (prefersReducedMotion()) {
      bar.style.width = `${target}%`
      return
    }
    const s = spring(ready ? 60 : 0, target, SPRINGS.gentle, (w) => {
      bar.style.width = `${Math.max(0, Math.min(103, w)).toFixed(2)}%`
    })
    return () => s.stop()
  }, [ready])

  // « Commencer ma journée » arrive en ressort une fois tout lu.
  useEffect(() => {
    if (!ready || !buttonRef.current) return
    pop(buttonRef.current, 80, 0.7)
    enter(buttonRef.current, 0, 10)
    impulse(buttonRef.current, 6)
  }, [ready])

  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true)
      // Le prototype joue son `done` quand la barre de lancement atteint 100 % — même instant ici.
      playSetupSound("done")
    }, 1400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    window.api.jira.countOpenIssues().then(setTicketCount).catch(() => setTicketCount(null))
  }, [])

  return (
    <div className="onboarding-screen">
      <div className="onboarding-ready" ref={rootRef}>
        <span className="onboarding-ready-check" ref={checkRef} aria-hidden="true">
          <CheckIcon size={26} />
        </span>
        <h1 className="onboarding-ready-title">C&apos;est prêt.</h1>
        <p className="onboarding-ready-subtitle">
          {ready
            ? ticketCount === null
              ? "Vos tickets sont relus."
              : `${ticketCount} ticket${ticketCount > 1 ? "s" : ""} relu${ticketCount > 1 ? "s" : ""}.`
            : "Je relis vos tickets en cours…"}
        </p>
        <div className="onboarding-ready-bar-track">
          <div className="onboarding-ready-bar-fill" ref={barRef} />
        </div>
        {ready && (
          <button ref={buttonRef} type="button" className="onboarding-button onboarding-button--primary" onClick={onStart}>
            Commencer ma journée
          </button>
        )}
      </div>
    </div>
  )
}

export default ReadyStep
