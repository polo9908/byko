import { useEffect, useRef } from "react"
import { pop, prefersReducedMotion, spring } from "@renderer/lib/motion"
import { useOnboardingPhysics } from "@renderer/lib/useOnboardingPhysics"
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
  const headerRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  useOnboardingPhysics(headerRef)

  // L'avatar éclot, et le segment qu'on vient de franchir se remplit en ressort (léger dépassement).
  useEffect(() => {
    if (avatarRef.current) pop(avatarRef.current, 0, 0.5)
    const segment = trackRef.current?.children[stepIndex - 1]
    if (!(segment instanceof HTMLElement) || prefersReducedMotion()) return
    segment.style.transformOrigin = "left center"
    const fill = spring(0, 1, { stiffness: 190, damping: 15 }, (p) => {
      segment.style.scale = p === 1 ? "" : `${Math.max(0, p).toFixed(4)} 1`
    })
    return () => fill.stop()
  }, [stepIndex])

  return (
    <div className="onboarding-header" ref={headerRef}>
      <span className="onboarding-avatar" ref={avatarRef} aria-hidden="true">
        B
      </span>
      <div className="onboarding-progress-track" ref={trackRef}>
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
