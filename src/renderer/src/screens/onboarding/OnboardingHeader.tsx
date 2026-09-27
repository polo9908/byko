import "./onboarding.css"

interface OnboardingHeaderProps {
  /** Index (0-based) de l'étape courante parmi `totalSteps`. */
  stepIndex: number
  totalSteps: number
  timeLabel: string
}

/**
 * En-tête partagé par tous les écrans d'onboarding (A1-A5), fidèle au
 * prototype : avatar "B", piste de progression segmentée, temps restant.
 * Mesures relevées sur `BCC Medium.html` (badge 26×26/radius 7px, segments
 * 3px de haut/radius 2px/gap 4px, temps en Geist Mono 12px).
 */
function OnboardingHeader({ stepIndex, totalSteps, timeLabel }: OnboardingHeaderProps): React.JSX.Element {
  return (
    <div className="onboarding-header">
      <span className="onboarding-avatar" aria-hidden="true">
        B
      </span>
      <div className="onboarding-progress-track">
        {Array.from({ length: totalSteps }).map((_, index) => (
          <span
            key={index}
            className={"onboarding-progress-segment" + (index < stepIndex ? " onboarding-progress-segment--done" : "")}
          />
        ))}
      </div>
      <span className="onboarding-time">{timeLabel}</span>
    </div>
  )
}

export default OnboardingHeader
