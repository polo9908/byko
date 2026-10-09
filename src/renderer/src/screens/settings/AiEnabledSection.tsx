import { useEffect, useRef, useState } from "react"
import type { PrivacySettings } from "@shared/privacy"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import Switch from "./Switch"

/**
 * Interrupteur général de l'IA (contrat : docs/ipc/ai-enabled.md). Désactivé, main refuse tout
 * appel au fournisseur : plus de tokens consommés, plus aucune donnée envoyée.
 */
function AiEnabledSection(): React.JSX.Element {
  const [settings, setSettings] = useState<PrivacySettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.api.privacy
      .get()
      .then((result) => {
        if (mountedRef.current) setSettings(result)
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setError(`Impossible de lire le réglage : ${cleanIpcErrorMessage(err)}`)
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function handleChange(next: boolean): Promise<void> {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const persisted = await window.api.privacy.setAiEnabled(next)
      if (!mountedRef.current) return
      setSettings(persisted)
      playSfx("tick")
    } catch (err) {
      // On n'affiche jamais l'état demandé comme acquis : le réglage reste celui qui est persisté.
      if (mountedRef.current) setError(`Le réglage n'a pas été enregistré : ${cleanIpcErrorMessage(err)}`)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const enabled = settings?.aiEnabled ?? false

  return (
    <>
      <p className="settings-section-label">Utilisation de l&apos;IA</p>
      <div className="settings-row settings-privacy-row">
        <div className="settings-row-info">
          <span className="settings-privacy-label" id="settings-ai-enabled-label">
            Utiliser l&apos;IA
          </span>
          <span className="settings-row-subtitle" id="settings-ai-enabled-help">
            {settings === null && !error
              ? "Lecture du réglage…"
              : enabled
                ? "Byko peut appeler votre fournisseur d'IA : réponses de Byko, comptes rendus, extraction des décisions en point d'équipe."
                : "Aucun appel à l'IA, aucun token consommé, aucune donnée envoyée. Agenda, journal et connecteurs restent utilisables."}
          </span>
        </div>
        {settings && (
          <Switch
            checked={enabled}
            onChange={(next) => void handleChange(next)}
            labelledBy="settings-ai-enabled-label"
            describedBy="settings-ai-enabled-help"
            disabled={saving}
          />
        )}
      </div>
      {error && (
        <div className="settings-privacy-help">
          <p className="settings-detail-error" role="alert">
            {error}
          </p>
        </div>
      )}
    </>
  )
}

export default AiEnabledSection
