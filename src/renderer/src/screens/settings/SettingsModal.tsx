import { useEffect, useRef, useState } from "react"
import type { ConnectorSummary, ConnectableConnectorId, UpcomingConnectorId } from "@shared/connectors"
import { AI_PROVIDERS } from "@shared/ai"
import type { AIProviderId } from "@shared/ai"
import type { GoogleCalendarCredentialsStatus } from "@shared/googleCalendar"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import GoogleCalendarSetupWizard from "./GoogleCalendarSetupWizard"
import JiraSetupWizard from "./JiraSetupWizard"
import FigmaSetupWizard from "./FigmaSetupWizard"
import AiSetupWizard from "./AiSetupWizard"
import UpcomingConnectorGuide from "./ConnectorGuides"
import "./settings.css"

interface SettingsModalProps {
  onClose: () => void
}

interface UnimplementedRow {
  id: UpcomingConnectorId
  letter: string
  color: string
  name: string
  subtitle: string
}

/** Sources sans backend réel pour l'instant (voir docs/backlog : E3 Slack, D2 Teams/Outlook/GitHub). */
const UNIMPLEMENTED_ROWS: UnimplementedRow[] = [
  { id: "slack", letter: "S", color: "#611F69", name: "Slack", subtitle: "Fils de discussion et notifications" },
  { id: "teams", letter: "T", color: "#5B5FC7", name: "Microsoft Teams", subtitle: "Réunions et messages" },
  { id: "outlook", letter: "O", color: "#0364B8", name: "Outlook", subtitle: "Agenda et e-mails" },
  { id: "github", letter: "G", color: "#1E1E1E", name: "GitHub", subtitle: "Pull requests liées aux tickets" },
]

/** Détail Jira (ticket D2) : rotation du jeton inline, fidèle au prototype (pas de déconnexion pour les connecteurs à jeton). */
function JiraDetail({ onRotated }: { onRotated: () => void }): React.JSX.Element {
  const [domain, setDomain] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [showInput, setShowInput] = useState(false)
  const [token, setToken] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.jira.getStatus().then((status) => {
      setDomain(status.domain ?? null)
      setEmail(status.email ?? null)
    })
  }, [])

  async function handleCreateToken(): Promise<void> {
    await window.api.jira.openTokenPage()
    setShowInput(true)
  }

  async function handleRotate(): Promise<void> {
    if (!token || !domain || !email) return
    setVerifying(true)
    setError(null)
    try {
      await window.api.jira.connect(domain, email, token)
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
        <button type="button" className="settings-rotate-button" onClick={handleCreateToken}>
          Nouveau jeton Jira ↗
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
            onClick={handleRotate}
          >
            {verifying ? "Vérification…" : "Mettre à jour"}
          </button>
        </>
      )}
      <span className="settings-detail-hint">Copiez-le, je le détecte.</span>
      {error && <p className="settings-detail-error">{error}</p>}
    </div>
  )
}

/** Détail Figma (ticket D2) : même principe de rotation que Jira. */
function FigmaDetail({ onRotated }: { onRotated: () => void }): React.JSX.Element {
  const [showInput, setShowInput] = useState(false)
  const [token, setToken] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreateToken(): Promise<void> {
    await window.api.figma.openTokenPage()
    setShowInput(true)
  }

  async function handleRotate(): Promise<void> {
    if (!token) return
    setVerifying(true)
    setError(null)
    try {
      await window.api.figma.connect(token)
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
        <button type="button" className="settings-rotate-button" onClick={handleCreateToken}>
          Nouveau jeton Figma ↗
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
            onClick={handleRotate}
          >
            {verifying ? "Vérification…" : "Mettre à jour"}
          </button>
        </>
      )}
      <span className="settings-detail-hint">Copiez-le, je le détecte.</span>
      {error && <p className="settings-detail-error">{error}</p>}
    </div>
  )
}

/** Détail IA (ticket D2) : grille de fournisseurs identique à A3, pour changer de fournisseur ou renouveler la clé. */
function AiDetail({ onRotated }: { onRotated: () => void }): React.JSX.Element {
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>("anthropic")
  const [token, setToken] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.ai.getStatus().then((status) => {
      if (status.provider) setSelectedProvider(status.provider)
    })
  }, [])

  async function handleCreateKey(): Promise<void> {
    await window.api.ai.openKeyPage(selectedProvider)
  }

  function handlePickProvider(provider: AIProviderId): void {
    if (provider === selectedProvider) return
    setSelectedProvider(provider)
    // `tick` du prototype (`pickProv`) : seulement en changeant réellement de fournisseur.
    playSfx("tick")
  }

  async function handleRotate(): Promise<void> {
    if (!token) return
    setVerifying(true)
    setError(null)
    try {
      await window.api.ai.setCustomKey(selectedProvider, token)
      setToken("")
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
      <div className="settings-ai-grid">
        {AI_PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className={"settings-ai-card" + (provider.id === selectedProvider ? " settings-ai-card--active" : "")}
            onClick={() => handlePickProvider(provider.id)}
          >
            <span className="settings-ai-card-icon" style={{ background: provider.color }}>
              {provider.letter}
            </span>
            {provider.label}
          </button>
        ))}
      </div>
      <button type="button" className="settings-rotate-button" onClick={handleCreateKey}>
        Créer un jeton {AI_PROVIDERS.find((provider) => provider.id === selectedProvider)?.label} ↗
      </button>
      <input
        className="settings-detail-input"
        type="password"
        placeholder="Collez la clé ici"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        onPaste={() => playSfx("tick")}
      />
      <button
        type="button"
        className="settings-rotate-button settings-rotate-button--submit"
        disabled={verifying || !token}
        onClick={handleRotate}
      >
        {verifying ? "Vérification…" : "Mettre à jour"}
      </button>
      {error && <p className="settings-detail-error">{error}</p>}
    </div>
  )
}

/**
 * Détail Google Agenda (ticket D2) : pas de jeton à faire tourner (OAuth),
 * juste une déconnexion avec confirmation en deux temps (jamais de
 * `window.confirm`, qui bloque le process de rendu dans Electron).
 */
function CalendarDetail({
  onRotated,
  onOpenWizard,
  credentials,
  credentialsError,
}: {
  onRotated: () => void
  onOpenWizard: () => void
  credentials: GoogleCalendarCredentialsStatus | null
  credentialsError: string | null
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDisconnect(): Promise<void> {
    setDisconnecting(true)
    setError(null)
    try {
      await window.api.calendar.disconnect()
      onRotated()
      // `undo` du prototype à la déconnexion d'une source.
      playSfx("undo")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setDisconnecting(false)
    }
  }

  return (
    <div className="settings-detail">
      {credentials && !credentials.configured && (
        <p className="settings-detail-warning">
          Google Agenda cessera de se synchroniser au plus tard dans l&apos;heure : BYKO n&apos;intègre plus de clé
          Google partagée. La frise de la journée reviendra alors aux jalons par défaut. Cliquez « Utiliser
          d&apos;autres identifiants Google » ci-dessous pour créer vos propres identifiants (2 minutes, une seule
          fois).
        </p>
      )}
      {credentials?.source === "dev-env" && (
        <span className="settings-detail-hint">Identifiants de développement (.env) en cours d&apos;utilisation.</span>
      )}
      {credentialsError && (
        <p className="settings-detail-error">Impossible de vérifier les identifiants Google : {credentialsError}</p>
      )}
      <button type="button" className="settings-rotate-button" onClick={onOpenWizard}>
        Utiliser d&apos;autres identifiants Google
      </button>
      {!confirming ? (
        <button type="button" className="settings-rotate-button" onClick={() => setConfirming(true)}>
          Se déconnecter
        </button>
      ) : (
        <>
          <span className="settings-detail-hint">Révoquer l&apos;accès à votre agenda Google ?</span>
          <button
            type="button"
            className="settings-rotate-button settings-rotate-button--submit"
            disabled={disconnecting}
            onClick={handleDisconnect}
          >
            {disconnecting ? "Déconnexion…" : "Confirmer la déconnexion"}
          </button>
        </>
      )}
      {error && <p className="settings-detail-error">{error}</p>}
    </div>
  )
}

function SettingsModal({ onClose }: SettingsModalProps): React.JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null)
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null)
  const [version, setVersion] = useState("")
  const [expandedId, setExpandedId] = useState<ConnectorSummary["id"] | null>(null)
  // Connecteur dont l'assistant de connexion est ouvert dans la modale (Jira, IA, Figma, ou Google Agenda).
  const [wizardId, setWizardId] = useState<ConnectableConnectorId | null>(null)
  // Connecteur sans backend dont le guide « Voir comment faire » est déplié.
  const [upcomingGuideId, setUpcomingGuideId] = useState<UpcomingConnectorId | null>(null)
  const [calendarConnecting, setCalendarConnecting] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  // Phase `connect()` proprement dite (navigateur ouvert), distincte de la pré-lecture des identifiants.
  const [calendarAuthorizing, setCalendarAuthorizing] = useState(false)
  const [calendarCancelling, setCalendarCancelling] = useState(false)
  const calendarAuthorizingRef = useRef(false)
  // Lu au niveau de la modale pour signaler la migration E4bis sur la rangée repliée.
  const [calendarCredentials, setCalendarCredentials] = useState<GoogleCalendarCredentialsStatus | null>(null)
  const [calendarCredentialsError, setCalendarCredentialsError] = useState<string | null>(null)

  function refreshConnectors(): void {
    window.api.settings.listConnectors().then(setConnectors)
    window.api.calendar
      .getCredentialsStatus()
      .then((status) => {
        setCalendarCredentials(status)
        setCalendarCredentialsError(null)
      })
      .catch((err: unknown) => {
        setCalendarCredentials(null)
        setCalendarCredentialsError(cleanIpcErrorMessage(err))
      })
  }

  useEffect(() => {
    refreshConnectors()
    window.api.secrets.isEncryptionAvailable().then(setEncryptionAvailable)
    window.api.getVersion().then(setVersion)
  }, [])

  // Même logique que l'assistant : fermer la modale pendant l'attente libère le verrou côté main,
  // sinon la tentative suivante serait refusée (« Une connexion Google est déjà en cours. »).
  useEffect(() => {
    return () => {
      if (calendarAuthorizingRef.current) {
        window.api.calendar.cancelConnect().catch((err: unknown) => {
          console.error("Annulation de la connexion Google impossible :", cleanIpcErrorMessage(err))
        })
      }
    }
  }, [])

  async function handleConnectCalendar(): Promise<void> {
    setCalendarConnecting(true)
    setCalendarError(null)
    try {
      const credentials = await window.api.calendar.getCredentialsStatus()
      if (!credentials.configured) {
        // Aucun client OAuth enregistré : l'utilisateur doit créer le sien (contrat E4bis).
        setWizardId("calendar")
        return
      }
      calendarAuthorizingRef.current = true
      setCalendarAuthorizing(true)
      await window.api.calendar.connect()
      refreshConnectors()
      playSfx("saved")
    } catch (err) {
      setCalendarError(cleanIpcErrorMessage(err))
    } finally {
      calendarAuthorizingRef.current = false
      setCalendarAuthorizing(false)
      setCalendarCancelling(false)
      setCalendarConnecting(false)
    }
  }

  async function handleCancelCalendarConnect(): Promise<void> {
    setCalendarCancelling(true)
    try {
      // Le rejet de `connect()` (« Connexion Google annulée. ») est affiché par handleConnectCalendar.
      await window.api.calendar.cancelConnect()
    } catch (err) {
      setCalendarError(cleanIpcErrorMessage(err))
      setCalendarCancelling(false)
    }
  }

  function handleWizardConnected(): void {
    setWizardId(null)
    setExpandedId(null)
    refreshConnectors()
    // `saved` du prototype : une source vient d'être réellement connectée.
    playSfx("saved")
  }

  const onConnectById: Record<ConnectorSummary["id"], () => void> = {
    jira: () => setWizardId("jira"),
    ai: () => setWizardId("ai"),
    figma: () => setWizardId("figma"),
    calendar: () => void handleConnectCalendar(),
  }

  const connectedRows = connectors?.filter((row) => row.connected) ?? []
  const disconnectedRows = connectors?.filter((row) => !row.connected) ?? []

  function renderDetail(id: ConnectorSummary["id"]): React.JSX.Element | null {
    const onRotated = (): void => {
      setExpandedId(null)
      refreshConnectors()
    }
    if (id === "jira") return <JiraDetail onRotated={onRotated} />
    if (id === "figma") return <FigmaDetail onRotated={onRotated} />
    if (id === "ai") return <AiDetail onRotated={onRotated} />
    if (id === "calendar")
      return (
        <CalendarDetail
          onRotated={onRotated}
          onOpenWizard={() => setWizardId("calendar")}
          credentials={calendarCredentials}
          credentialsError={calendarCredentialsError}
        />
      )
    return null
  }

  function renderWizard(id: ConnectableConnectorId): React.JSX.Element {
    const onCancel = (): void => setWizardId(null)
    if (id === "jira") return <JiraSetupWizard onConnected={handleWizardConnected} onCancel={onCancel} />
    if (id === "figma") return <FigmaSetupWizard onConnected={handleWizardConnected} onCancel={onCancel} />
    if (id === "ai") return <AiSetupWizard onConnected={handleWizardConnected} onCancel={onCancel} />
    return <GoogleCalendarSetupWizard onConnected={handleWizardConnected} onCancel={onCancel} />
  }

  function renderConnectorRow(row: ConnectorSummary): React.JSX.Element {
    const expanded = expandedId === row.id
    const wizardOpen = wizardId === row.id
    return (
      <div key={row.id}>
        <div
          className="settings-row"
          role={row.connected ? "button" : undefined}
          onClick={row.connected ? () => setExpandedId(expanded ? null : row.id) : undefined}
        >
          <div className="settings-row-icon" style={{ background: row.color }}>
            {row.letter}
          </div>
          <div className="settings-row-info">
            <span className="settings-row-name">{row.label}</span>
            <span className="settings-row-subtitle">{row.detail ?? "Non connecté"}</span>
            {row.id === "calendar" && row.connected && calendarCredentials && !calendarCredentials.configured && (
              <span className="settings-row-subtitle settings-row-subtitle--warning">
                Action requise : identifiants Google à configurer
              </span>
            )}
            {row.id === "calendar" && row.connected && calendarCredentialsError && (
              <span className="settings-row-subtitle settings-row-subtitle--warning">
                Identifiants Google : vérification impossible
              </span>
            )}
          </div>
          {row.connected ? (
            <div className="settings-row-status">
              <span className="settings-dot" aria-hidden="true" />
              <span className={"settings-chevron" + (expanded ? " settings-chevron--open" : "")} aria-hidden="true">
                ›
              </span>
            </div>
          ) : (
            <>
              {row.id === "calendar" && calendarAuthorizing && (
                <button
                  type="button"
                  className="settings-connect-button"
                  disabled={calendarCancelling}
                  onClick={() => void handleCancelCalendarConnect()}
                >
                  {calendarCancelling ? "Annulation…" : "Annuler"}
                </button>
              )}
              <button
                type="button"
                className="settings-connect-button"
                disabled={wizardOpen || (row.id === "calendar" && calendarConnecting)}
                onClick={onConnectById[row.id]}
              >
                {row.id === "calendar" && calendarConnecting ? "Connexion…" : "Connecter"}
              </button>
            </>
          )}
        </div>
        {row.id === "calendar" && calendarError && <p className="settings-detail-error">{calendarError}</p>}
        {wizardOpen ? renderWizard(row.id) : expanded && renderDetail(row.id)}
      </div>
    )
  }

  function renderUnimplementedRow(row: UnimplementedRow): React.JSX.Element {
    const guideOpen = upcomingGuideId === row.id
    return (
      <div key={row.id}>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: row.color }}>
            {row.letter}
          </div>
          <div className="settings-row-info">
            <span className="settings-row-name">{row.name}</span>
            <span className="settings-row-subtitle">{row.subtitle}</span>
          </div>
          <div className="settings-row-actions">
            <button
              type="button"
              className="settings-guide-toggle"
              onClick={() => setUpcomingGuideId(guideOpen ? null : row.id)}
            >
              {guideOpen ? "Masquer" : "Voir comment faire"}
            </button>
            <button type="button" className="settings-connect-button" disabled title="Bientôt disponible">
              Connecter
            </button>
          </div>
        </div>
        {guideOpen && <UpcomingConnectorGuide id={row.id} />}
      </div>
    )
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">Réglages</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        {connectedRows.length > 0 && (
          <>
            <p className="settings-section-label">Connecté</p>
            {connectedRows.map(renderConnectorRow)}
          </>
        )}

        <p className="settings-section-label">Ajouter une source</p>
        {disconnectedRows.map(renderConnectorRow)}
        {UNIMPLEMENTED_ROWS.map(renderUnimplementedRow)}

        <div className="settings-footer">
          <span className="settings-footer-lock">
            🔒 {encryptionAvailable ? "Clés chiffrées sur cet appareil" : "Chiffrement indisponible sur cet appareil"}
          </span>
          <span>BCC {version}</span>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
