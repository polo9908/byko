import { useState } from "react"
import type { GithubConnectionStatus } from "@shared/links"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import SetupWizard from "./SetupWizard"
import "./settings.css"

interface GithubSetupWizardProps {
  onConnected: (status: GithubConnectionStatus) => void
  onCancel?: () => void
}

/** Connexion GitHub depuis Réglages : même pattern de jeton guidé que Jira et Figma. Le jeton ne sert qu'à lire. */
function GithubSetupWizard({ onConnected, onCancel }: GithubSetupWizardProps): React.JSX.Element {
  const [token, setToken] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleTest(): Promise<void> {
    setVerifying(true)
    setError(null)
    try {
      const status = await window.api.github.connect(token)
      setToken("")
      onConnected(status)
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <SetupWizard
      title="Connecter GitHub avec votre propre jeton"
      intro={
        <>
          Byko lit vos pull requests et vos releases pour les relier aux tickets créés en réunion. Il
          n&apos;écrit jamais sur GitHub ; le jeton est enregistré, chiffré, uniquement sur cet appareil.
        </>
      }
      steps={[
        {
          title: "Ouvrir la création d'un jeton « fine-grained »",
          body: <>Connectez-vous, nommez le jeton « Byko » et choisissez une durée raisonnable.</>,
          open: () => window.api.github.openTokenPage(),
        },
        {
          title: "Limiter le jeton aux dépôts concernés",
          body: <>« Only select repositories », puis les dépôts dont Byko doit suivre les pull requests.</>,
        },
        {
          title: "Autoriser la lecture seule",
          body: <>Permissions du dépôt : « Pull requests » et « Contents » en lecture (« Read-only »).</>,
        },
        {
          title: "Copier le jeton et le coller ci-dessous",
          body: <>GitHub ne l&apos;affiche qu&apos;une fois : copiez-le tout de suite.</>,
        },
      ]}
      error={error}
      submit={{
        label: verifying ? "Vérification…" : "Tester la connexion",
        disabled: verifying || token.trim() === "",
        onClick: () => void handleTest(),
      }}
      close={onCancel ? { label: "Fermer l'assistant", onClick: onCancel } : undefined}
    >
      <label className="setup-wizard-label">
        Jeton GitHub
        <input
          className="settings-detail-input settings-detail-input--mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={verifying}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
    </SetupWizard>
  )
}

/** Détail GitHub dans Réglages : renouvellement du jeton, même principe que Jira et Figma. */
export function GithubDetail({ onRotated }: { onRotated: () => void }): React.JSX.Element {
  const [showInput, setShowInput] = useState(false)
  const [token, setToken] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateToken(): Promise<void> {
    await window.api.github.openTokenPage()
    setShowInput(true)
  }

  async function handleRotate(): Promise<void> {
    if (!token) return
    setVerifying(true)
    setError(null)
    try {
      await window.api.github.connect(token)
      setToken("")
      setShowInput(false)
      onRotated()
      playSfx("saved")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="settings-detail">
      {!showInput ? (
        <button type="button" className="settings-rotate-button" onClick={() => void handleCreateToken()}>
          Nouveau jeton GitHub ↗
        </button>
      ) : (
        <>
          <input
            className="settings-detail-input"
            type="password"
            placeholder="Collez le nouveau jeton ici"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onPaste={() => playSfx("tick")}
          />
          <button
            type="button"
            className="settings-rotate-button settings-rotate-button--submit"
            disabled={verifying || !token}
            onClick={() => void handleRotate()}
          >
            {verifying ? "Vérification…" : "Mettre à jour"}
          </button>
        </>
      )}
      {error && <p className="settings-detail-error">{error}</p>}
    </div>
  )
}

export default GithubSetupWizard
