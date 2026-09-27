import { useEffect, useState } from "react"
import type { GoogleCalendarConnectionStatus } from "@shared/googleCalendar"
import GoogleCalendarSetupWizard from "../settings/GoogleCalendarSetupWizard"
import OnboardingHeader from "./OnboardingHeader"
import { playSetupSound } from "@renderer/lib/sound"
import "./onboarding.css"

interface ConnectCalendarStepProps {
  onBack?: () => void
  onContinue: (status: GoogleCalendarConnectionStatus) => void
  onSkip: () => void
}

/**
 * Étape d'onboarding « Branchez votre agenda. », optionnelle (skip via
 * « Plus tard »). Réutilise l'assistant de connexion de Réglages : BYKO
 * n'embarque aucun client OAuth Google, l'utilisateur crée le sien
 * (contrat `docs/ipc/google-calendar-credentials.md`).
 */
function ConnectCalendarStep({ onBack, onContinue, onSkip }: ConnectCalendarStepProps): React.JSX.Element {
  const [status, setStatus] = useState<GoogleCalendarConnectionStatus | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    window.api.calendar
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus({ connected: false }))
      .finally(() => setChecking(false))
  }, [])

  const connected = status?.connected ?? false

  return (
    <div className="onboarding-screen">
      <section className="onboarding-step">
        <OnboardingHeader stepIndex={4} totalSteps={5} timeLabel="2 min" />

        <div className="onboarding-icon onboarding-icon--calendar" aria-hidden="true">
          G
        </div>
        <h1 className="onboarding-title">Branchez votre agenda.</h1>
        <p className="onboarding-subtitle">Pour que la frise de votre journée suive vos vraies réunions.</p>

        <div className="onboarding-card">
          {checking ? (
            <p className="onboarding-hint">Vérification de Google Agenda…</p>
          ) : connected && status ? (
            <div className="onboarding-connected">
              <div className="onboarding-card-row onboarding-card-row--success">
                <span className="onboarding-check" aria-hidden="true">
                  ✓
                </span>
                <span>Connecté à {status.email}</span>
              </div>
            </div>
          ) : (
            <GoogleCalendarSetupWizard
              onConnected={(value) => {
                playSetupSound("ok")
                setStatus(value)
              }}
            />
          )}
        </div>

        <p className="onboarding-hint">Vous pourrez connecter Google Agenda à tout moment dans Réglages.</p>

        <div className="onboarding-actions">
          {onBack ? (
            <button type="button" className="onboarding-link onboarding-link--muted" onClick={onBack}>
              Retour
            </button>
          ) : (
            <span />
          )}
          <div className="onboarding-choice-row">
            {connected ? (
              <button
                type="button"
                className="onboarding-button onboarding-button--primary"
                onClick={() => status && onContinue(status)}
              >
                Continuer
              </button>
            ) : (
              <button type="button" className="onboarding-button onboarding-button--secondary" onClick={onSkip}>
                Plus tard
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default ConnectCalendarStep
