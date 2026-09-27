import { useState } from "react"
import type { FigmaConnectionStatus } from "@shared/figma"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import SetupWizard from "./SetupWizard"
import "./settings.css"

interface FigmaSetupWizardProps {
  onConnected: (status: FigmaConnectionStatus) => void
  onCancel?: () => void
}

/** Connexion Figma depuis Réglages : même pattern de jeton guidé que Jira (E5). */
function FigmaSetupWizard({ onConnected, onCancel }: FigmaSetupWizardProps): React.JSX.Element {
  const [token, setToken] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleTest(): Promise<void> {
    setVerifying(true)
    setError(null)
    try {
      const status = await window.api.figma.connect(token)
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
      title="Connecter Figma avec votre propre jeton"
      intro={
        <>
          BYKO ne stocke aucun jeton partagé : vous créez le vôtre et il n&apos;est enregistré,
          chiffré, que sur cet appareil.
        </>
      }
      steps={[
        {
          title: "Ouvrir les réglages de votre compte Figma",
          body: <>Connectez-vous, puis ouvrez l&apos;onglet « Sécurité ».</>,
          open: () => window.api.figma.openTokenPage(),
        },
        {
          title: "Créer un jeton personnel nommé « BCC »",
          body: <>Dans « Jetons personnels », cliquez « Générer un nouveau jeton ».</>,
        },
        {
          title: "Copier le jeton et le coller ci-dessous",
          body: <>Figma ne l&apos;affiche qu&apos;une fois : copiez-le tout de suite.</>,
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
        Jeton Figma
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

export default FigmaSetupWizard
