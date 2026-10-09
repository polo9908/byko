import { useEffect, useRef, useState } from "react"
import { impulse } from "@renderer/lib/motion"
import { playSetupSound } from "@renderer/lib/sound"
import { PROFILE_ROLES } from "@shared/profile"
import type { ProfileRole } from "@shared/profile"
import OnboardingHeader from "./OnboardingHeader"
import OtherAccountsList from "./OtherAccountsList"
import { LinkIcon, ClockIcon, LockIcon } from "./icons"
import "./onboarding.css"

interface WelcomeStepProps {
  /** E-mail déjà mémorisé (première configuration interrompue) : le champ revient pré-rempli. */
  initialEmail?: string
  /** Rôle déjà mémorisé (première configuration interrompue). */
  initialRole?: ProfileRole
  onContinue: (email: string, role: ProfileRole) => void
}

/**
 * Étape A1 « Configurons BCC. », fidèle au prototype (`BCC Medium.html`) :
 * même en-tête de progression, même ligne méta (connexions/temps/chiffrement),
 * même carte avec le champ e-mail. Contrairement au prototype (données de
 * démo), le champ n'est pas pré-rempli et la ligne « Repris de votre
 * session » n'est pas affichée : aucune détection de session réelle n'existe
 * encore côté app, et l'afficher sans support serait mensonger.
 */
function WelcomeStep({ initialEmail = "", initialRole, onContinue }: WelcomeStepProps): React.JSX.Element {
  const [email, setEmail] = useState(initialEmail)
  const startRef = useRef<HTMLButtonElement>(null)
  const [role, setRole] = useState<ProfileRole | undefined>(initialRole)
  const valid = email.includes("@") && role !== undefined
  // Pré-rempli : déjà valide à l'affichage, pas de « pop » ni de rebond du bouton.
  const wasValid = useRef(valid)

  // Le bouton s'allume quand l'adresse devient plausible : petit rebond et « pop », une seule fois par passage.
  useEffect(() => {
    if (valid && !wasValid.current) {
      playSetupSound("pop")
      if (startRef.current) impulse(startRef.current, 9)
    }
    wasValid.current = valid
  }, [valid])

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
          <span className="onboarding-field-label" id="welcome-role-label">
            Votre rôle dans l&apos;équipe
          </span>
          <div className="onboarding-ai-grid" role="radiogroup" aria-labelledby="welcome-role-label">
            {PROFILE_ROLES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === role}
                className={"onboarding-ai-card" + (item.id === role ? " onboarding-ai-card--active" : "")}
                onClick={() => setRole(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="onboarding-hint">Modifiable à tout moment dans les Réglages.</p>
        </div>

        <div className="onboarding-actions">
          <span />
          <button
            type="button"
            ref={startRef}
            className="onboarding-button onboarding-button--primary"
            disabled={!valid}
            onClick={() => role && onContinue(email, role)}
          >
            Commencer
          </button>
        </div>

        <OtherAccountsList />
      </section>
    </div>
  )
}

export default WelcomeStep
