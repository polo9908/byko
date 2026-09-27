import { useEffect, useState } from "react"
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
      <div className="onboarding-ready">
        <span className="onboarding-ready-check" aria-hidden="true">
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
          <div className="onboarding-ready-bar-fill" style={{ width: ready ? "100%" : "60%" }} />
        </div>
        {ready && (
          <button type="button" className="onboarding-button onboarding-button--primary" onClick={onStart}>
            Commencer ma journée
          </button>
        )}
      </div>
    </div>
  )
}

export default ReadyStep
