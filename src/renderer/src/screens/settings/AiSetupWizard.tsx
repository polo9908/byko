import { useEffect, useState } from "react"
import { AI_PROVIDERS, getProviderMeta } from "@shared/ai"
import type { AIConnectionStatus, AIProviderId } from "@shared/ai"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import SetupWizard from "./SetupWizard"
import "./settings.css"

interface AiSetupWizardProps {
  onConnected: (status: AIConnectionStatus) => void
  onCancel?: () => void
}

/**
 * Connexion du fournisseur IA depuis Réglages : guide pas-à-pas vers la
 * console du fournisseur choisi, puis vérification de la clé (E2). Le guide
 * suit le fournisseur sélectionné dans la grille.
 */
function AiSetupWizard({ onConnected, onCancel }: AiSetupWizardProps): React.JSX.Element {
  const [provider, setProvider] = useState<AIProviderId>("anthropic")
  const [key, setKey] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const meta = getProviderMeta(provider)

  // Pré-sélectionne le fournisseur déjà détecté ou connecté sur l'appareil, comme le détail IA.
  useEffect(() => {
    window.api.ai.getStatus().then((status) => {
      if (status.provider) setProvider(status.provider)
    })
  }, [])

  function selectProvider(id: AIProviderId): void {
    setProvider(id)
    setKey("")
    setError(null)
  }

  async function handleTest(): Promise<void> {
    setVerifying(true)
    setError(null)
    try {
      const status = await window.api.ai.setCustomKey(provider, key)
      setKey("")
      onConnected(status)
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <SetupWizard
      title="Connecter votre IA avec votre propre clé"
      intro={
        <>
          Byko n&apos;intègre aucune clé partagée : vous gardez votre compte {meta.label} et le
          contrôlez depuis sa console. La clé n&apos;est enregistrée, chiffrée, que sur cet appareil.
        </>
      }
      steps={[
        {
          title: `Ouvrir la console ${meta.label}`,
          body: <>Connectez-vous, puis ouvrez la page de création de clés API.</>,
          open: () => window.api.ai.openKeyPage(provider),
        },
        {
          title: "Créer une clé nommée « Byko »",
          body: <>Pour retrouver facilement qui l&apos;utilise, puis validez la création.</>,
        },
        {
          title: "Copier la clé et la coller ci-dessous",
          body: <>La plupart des consoles ne l&apos;affichent qu&apos;une fois : copiez-la tout de suite.</>,
        },
      ]}
      error={error}
      submit={{
        label: verifying ? "Vérification…" : "Tester la connexion",
        disabled: verifying || key.trim() === "",
        onClick: () => void handleTest(),
      }}
      close={onCancel ? { label: "Fermer l'assistant", onClick: onCancel } : undefined}
    >
      <div className="settings-ai-grid">
        {AI_PROVIDERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={"settings-ai-card" + (item.id === provider ? " settings-ai-card--active" : "")}
            disabled={verifying}
            onClick={() => selectProvider(item.id)}
          >
            <span className="settings-ai-card-icon" style={{ background: item.color }}>
              {item.letter}
            </span>
            {item.label}
          </button>
        ))}
      </div>
      <label className="setup-wizard-label">
        Clé API {meta.label}
        <input
          className="settings-detail-input settings-detail-input--mono"
          type="password"
          placeholder={meta.keyPlaceholder}
          autoComplete="off"
          spellCheck={false}
          disabled={verifying}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
    </SetupWizard>
  )
}

export default AiSetupWizard
