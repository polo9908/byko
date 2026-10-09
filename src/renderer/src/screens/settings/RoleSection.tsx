import { useEffect, useRef, useState } from "react"
import { PROFILE_ROLES } from "@shared/profile"
import type { ProfileRole } from "@shared/profile"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"

/**
 * Rôle du compte actif (contrat : docs/ipc/profile.md), choisi à la configuration et modifiable ici. Le choix n'apparaît
 * retenu qu'une fois réellement enregistré par main.
 */
function RoleSection(): React.JSX.Element {
  const [role, setRole] = useState<ProfileRole | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.api.profile
      .get()
      .then((profile) => {
        if (mountedRef.current) setRole(profile.role ?? null)
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setError(`Impossible de lire le rôle : ${cleanIpcErrorMessage(err)}`)
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function choose(next: ProfileRole): Promise<void> {
    if (busy || next === role) return
    setBusy(true)
    setError(null)
    try {
      await window.api.profile.saveRole(next)
      if (mountedRef.current) setRole(next)
      playSfx("tick")
    } catch (err) {
      if (mountedRef.current) setError(cleanIpcErrorMessage(err))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <>
      <p className="settings-section-label" id="settings-role-label">
        Mon rôle
      </p>
      <div className="settings-vocab-form">
        <div className="settings-ai-grid" role="radiogroup" aria-labelledby="settings-role-label">
          {PROFILE_ROLES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.id === role}
              disabled={busy || role === undefined}
              className={"settings-ai-card" + (item.id === role ? " settings-ai-card--active" : "")}
              onClick={() => void choose(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {role === null && <p className="settings-detail-hint">Aucun rôle choisi pour ce compte.</p>}
        {error && (
          <p className="settings-detail-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  )
}

export default RoleSection
