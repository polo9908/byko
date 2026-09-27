import { useState } from "react"
import OnboardingHeader from "./OnboardingHeader"
import { LinkIcon, ClockIcon, LockIcon } from "./icons"
import "./onboarding.css"

interface WelcomeStepProps {
  onContinue: (email: string) => void
}

/**
 * Étape A1 « Configurons BCC. », fidèle au prototype (`BCC Medium.html`) :
 * même en-tête de progression, même ligne méta (connexions/temps/chiffrement),
 * même carte avec le champ e-mail. Contrairement au prototype (données de
 * démo), le champ n'est pas pré-rempli et la ligne « Repris de votre
 * session » n'est pas affichée : aucune détection de session réelle n'existe
 * encore côté app, et l'afficher sans support serait mensonger.
 */
function WelcomeStep({ onContinue }: WelcomeStepProps): React.JSX.Element {
  const [email, setEmail] = useState("")

  return (
    <div className="onboarding-screen">
      <section className="onboarding-step">
        <OnboardingHeader stepIndex={0} totalSteps={5} timeLabel="2 min" />

        <h1 className="onboarding-title">Configurons BCC.</h1>

        <div className="onboarding-meta-row">
          <span className="onboarding-meta-item">
            <LinkIcon /> 4 connexions
          </span>
          <span className="onboarding-meta-item">
            <ClockIcon /> ≈ 2 min
          </span>
          <span className="onboarding-meta-item">
            <LockIcon /> Chiffré sur cet appareil
          </span>
        </div>

        <div className="onboarding-card">
          <label className="onboarding-field-label" htmlFor="welcome-email">
            Votre e-mail professionnel
          </label>
          <input
            id="welcome-email"
            className="onboarding-input"
            type="text"
            placeholder="vous@entreprise.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoFocus
          />
        </div>

        <div className="onboarding-actions">
          <span />
          <button
            type="button"
            className="onboarding-button onboarding-button--primary"
            disabled={!email.includes("@")}
            onClick={() => onContinue(email)}
          >
            Commencer
          </button>
        </div>
      </section>
    </div>
  )
}

export default WelcomeStep
