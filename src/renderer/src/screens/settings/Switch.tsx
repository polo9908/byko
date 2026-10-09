import { useRef } from "react"
import { useSwitchSpring } from "@renderer/lib/useMotion"

interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** Identifiant de l'élément qui nomme l'interrupteur (aria-labelledby). */
  labelledBy: string
  describedBy?: string
  disabled?: boolean
}

/** Interrupteur des Réglages (ressort partagé avec PrivacySection : voir useSwitchSpring). */
function Switch({ checked, onChange, labelledBy, describedBy, disabled = false }: SwitchProps): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useSwitchSpring(ref, checked)
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled}
      className={"settings-switch" + (checked ? " settings-switch--on" : "")}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
    >
      <span className="settings-switch-thumb" aria-hidden="true" />
    </button>
  )
}

export default Switch
