import { useEffect, useState } from "react"
import { AI_PROVIDERS, getProviderMeta } from "@shared/ai"
import type { AIConnectionStatus, AIProviderId } from "@shared/ai"
import OnboardingHeader from "./OnboardingHeader"
import { KeyIcon } from "./icons"
import { playSetupSound } from "@renderer/lib/sound"
import "./onboarding.css"

interface ChooseAiStepProps {
  onBack?: () => void
  onContinue: (status: AIConnectionStatus) => void
}

/** `ipcRenderer.invoke` préfixe tout rejet avec "Error invoking remote method '<canal>': " : on l'enlève pour l'UI. */
function cleanIpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

function ChooseAiStep({ onBack, onContinue }: ChooseAiStepProps): React.JSX.Element {
  const [status, setStatus] = useState<AIConnectionStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>("anthropic")
  const [manualMode, setManualMode] = useState(false)
  const [showManualToken, setShowManualToken] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [customKey, setCustomKey] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.ai
      .getStatus()
      .then((result) => {
        setStatus(result)
        if (result.provider) setSelectedProvider(result.provider)
        else setManualMode(true)
      })
      .finally(() => setLoadingStatus(false))
  }, [])

  const connected = status?.connected && status.provider === selectedProvider
  const detectedHere = status?.detectedOnDevice && status.provider === selectedProvider && !manualMode

  function selectProvider(provider: AIProviderId): void {
    setSelectedProvider(provider)
    setShowManualToken(false)
    setCustomKey("")
    setError(null)
  }

  async function handleCreateKey(): Promise<void> {
    await window.api.ai.openKeyPage(selectedProvider)
    setShowManualToken(true)
  }

  async function handleUseDetectedKey(): Promise<void> {
    setVerifying(true)
    setError(null)
    try {
      setStatus(await window.api.ai.useDetectedKey(selectedProvider))
      playSetupSound("ok")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      playSetupSound("err")
    } finally {
      setVerifying(false)
    }
  }

  async function handleUseCustomKey(): Promise<void> {
    if (!customKey) return
    setVerifying(true)
    setError(null)
    try {
      setStatus(await window.api.ai.setCustomKey(selectedProvider, customKey))
      playSetupSound("ok")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      playSetupSound("err")
    } finally {
      setVerifying(false)
    }
  }

  async function handleDisconnect(): Promise<void> {
    await window.api.ai.disconnect(selectedProvider)
    setStatus({ connected: false })
    setCustomKey("")
    setManualMode(true)
  }

  function handleContinue(): void {
    if (status?.connected) onContinue(status)
  }

  return (
    <div className="onboarding-screen">
      <section className="onboarding-step">
        <OnboardingHeader stepIndex={2} totalSteps={5} timeLabel="1 min" />

        <div className="onboarding-icon onboarding-icon--ai" aria-hidden="true">
          ✦
        </div>
        <h1 className="onboarding-title">Choisissez votre IA.</h1>
        <p className="onboarding-subtitle">
          C&apos;est elle qui lit et compare vos tickets. Vous gardez votre propre compte.
        </p>

        <div className="onboarding-card">
          {loadingStatus ? (
            <p className="onboarding-hint">Recherche d&apos;une clé sur cet appareil…</p>
          ) : connected && status ? (
            <div className="onboarding-connected">
              <div className="onboarding-card-row onboarding-card-row--success">
                <span className="onboarding-check" aria-hidden="true">
                  ✓
                </span>
                <span>{getProviderMeta(selectedProvider).label} connecté</span>
              </div>
              <button type="button" className="onboarding-link onboarding-link--muted" onClick={handleDisconnect}>
                Déconnecter
              </button>
            </div>
          ) : detectedHere && status ? (
            <>
              <div className="onboarding-card-row">
                <KeyIcon size={18} />
                <div className="onboarding-domain-info">
                  <span className="onboarding-domain-name">
                    Une clé {getProviderMeta(selectedProvider).label} est déjà sur cet ordinateur.
                  </span>
                  <span className="onboarding-domain-hint">
                    {getProviderMeta(selectedProvider).envVar} · {status.maskedKey}
                  </span>
                </div>
              </div>
              <div className="onboarding-choice-row">
                <button
                  type="button"
                  className="onboarding-button onboarding-button--primary"
                  disabled={verifying}
                  onClick={handleUseDetectedKey}
                >
                  {verifying ? "Vérification…" : "Utiliser cette clé"}
                </button>
                <button
                  type="button"
                  className="onboarding-button onboarding-button--secondary"
                  onClick={() => setManualMode(true)}
                >
                  Un autre fournisseur
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="onboarding-ai-grid">
                {AI_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={
                      "onboarding-ai-card" + (provider.id === selectedProvider ? " onboarding-ai-card--active" : "")
                    }
                    onClick={() => selectProvider(provider.id)}
                  >
                    <span className="onboarding-ai-card-icon" style={{ background: provider.color }}>
                      {provider.letter}
                    </span>
                    {provider.label}
                  </button>
                ))}
              </div>

              <hr className="onboarding-divider" />

              <button type="button" className="onboarding-button onboarding-button--accent" onClick={handleCreateKey}>
                Créer un jeton {getProviderMeta(selectedProvider).label} ↗
              </button>

              <ol className="onboarding-checklist">
                <li>
                  <span className="onboarding-checklist-index">1</span>« Create key »
                </li>
                <li>
                  <span className="onboarding-checklist-index">2</span>Nommez-la « BCC »
                </li>
                <li>
                  <span className="onboarding-checklist-index">3</span>Copiez la clé
                </li>
              </ol>

              <p className="onboarding-hint">Revenez ici : je détecte le jeton copié et je vérifie tout seul.</p>

              {!showManualToken ? (
                <button type="button" className="onboarding-link" onClick={() => setShowManualToken(true)}>
                  Coller le jeton moi-même
                </button>
              ) : (
                <input
                  className="onboarding-input"
                  type="password"
                  placeholder={getProviderMeta(selectedProvider).keyPlaceholder}
                  value={customKey}
                  onChange={(event) => setCustomKey(event.target.value)}
                  onPaste={() => playSetupSound("tick")}
                />
              )}

              {showManualToken && (
                <button
                  type="button"
                  className="onboarding-button onboarding-button--primary"
                  disabled={!customKey || verifying}
                  onClick={handleUseCustomKey}
                >
                  {verifying ? "Vérification…" : "Connecter"}
                </button>
              )}

              {error && <p className="onboarding-error">{error}</p>}
            </>
          )}
        </div>

        <div className="onboarding-actions">
          {onBack ? (
            <button type="button" className="onboarding-link onboarding-link--muted" onClick={onBack}>
              Retour
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="onboarding-button onboarding-button--primary"
            disabled={!connected}
            onClick={handleContinue}
          >
            Continuer
          </button>
        </div>
      </section>
    </div>
  )
}

export default ChooseAiStep
