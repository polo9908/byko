import { useState } from "react"
import type { FigmaConnectionStatus } from "@shared/figma"
import OnboardingHeader from "./OnboardingHeader"
import { playSetupSound } from "@renderer/lib/sound"
import "./onboarding.css"

interface ConnectFigmaStepProps {
  onBack?: () => void
  onContinue: (status: FigmaConnectionStatus) => void
  onSkip: () => void
}

/** `ipcRenderer.invoke` préfixe tout rejet avec "Error invoking remote method '<canal>': " : on l'enlève pour l'UI. */
function cleanIpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

type Phase = "idle" | "connecting" | "connected"

/** Étape A4 « Ajoutez Figma. », optionnelle (skip via « Plus tard »), fidèle au prototype. */
function ConnectFigmaStep({ onBack, onContinue, onSkip }: ConnectFigmaStepProps): React.JSX.Element {
  const [showManualToken, setShowManualToken] = useState(false)
  const [token, setToken] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState<FigmaConnectionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateToken(): Promise<void> {
    await window.api.figma.openTokenPage()
    setShowManualToken(true)
  }

  async function handleConnect(): Promise<void> {
    if (!token) return
    setPhase("connecting")
    setError(null)
    try {
      const result = await window.api.figma.connect(token)
      setStatus(result)
      setPhase("connected")
      playSetupSound("ok")
    } catch (err) {
      setPhase("idle")
      setError(cleanIpcErrorMessage(err))
      playSetupSound("err")
    }
  }

  async function handleDisconnect(): Promise<void> {
    await window.api.figma.disconnect()
    setStatus(null)
    setPhase("idle")
    setToken("")
  }

  function handleContinue(): void {
    if (status) onContinue(status)
  }

  return (
    <div className="onboarding-screen">
      <section className="onboarding-step">
        <OnboardingHeader stepIndex={3} totalSteps={5} timeLabel="35 s" />

        <div className="onboarding-icon onboarding-icon--figma" aria-hidden="true">
          F
        </div>
        <h1 className="onboarding-title">Ajoutez Figma.</h1>
        <p className="onboarding-subtitle">Pour repérer les composants réutilisables et les écarts avec vos maquettes.</p>

        <div className="onboarding-card">
          {phase === "connected" && status ? (
            <div className="onboarding-connected">
              <div className="onboarding-card-row onboarding-card-row--success">
                <span className="onboarding-check" aria-hidden="true">
                  ✓
                </span>
                <span>Connecté en tant que {status.handle ?? status.email}</span>
              </div>
              <button type="button" className="onboarding-link onboarding-link--muted" onClick={handleDisconnect}>
                Déconnecter
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="onboarding-button onboarding-button--accent" onClick={handleCreateToken}>
                Créer un jeton Figma ↗
              </button>

              <ol className="onboarding-checklist">
                <li>
                  <span className="onboarding-checklist-index">1</span>Onglet « Sécurité »
                </li>
                <li>
                  <span className="onboarding-checklist-index">2</span>Nommez-le « Byko »
                </li>
                <li>
                  <span className="onboarding-checklist-index">3</span>Copiez le jeton
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
                  placeholder="Collez le jeton ici"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  onPaste={() => playSetupSound("tick")}
                />
              )}

              {error && <p className="onboarding-error">{error}</p>}
            </>
          )}
        </div>

        <p className="onboarding-hint">Vous pourrez connecter Figma à tout moment dans Paramètres.</p>

        <div className="onboarding-actions">
          {onBack ? (
            <button type="button" className="onboarding-link onboarding-link--muted" onClick={onBack}>
              Retour
            </button>
          ) : (
            <span />
          )}
          <div className="onboarding-choice-row">
            {phase === "connected" ? (
              <button type="button" className="onboarding-button onboarding-button--primary" onClick={handleContinue}>
                Continuer
              </button>
            ) : (
              <>
                <button type="button" className="onboarding-button onboarding-button--secondary" onClick={onSkip}>
                  Plus tard
                </button>
                <button
                  type="button"
                  className="onboarding-button onboarding-button--primary"
                  disabled={!token || phase === "connecting"}
                  onClick={handleConnect}
                >
                  {phase === "connecting" ? "Vérification…" : "Continuer"}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default ConnectFigmaStep
