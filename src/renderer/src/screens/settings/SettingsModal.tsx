import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ConnectorSummary, ConnectableConnectorId, UpcomingConnectorId } from "@shared/connectors"
import { AI_PROVIDERS } from "@shared/ai"
import type { AIProviderId } from "@shared/ai"
import type { GoogleCalendarCredentialsStatus } from "@shared/googleCalendar"
import type { PrivacySettings } from "@shared/privacy"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import { prefersReducedMotion, spring, SPRINGS } from "@renderer/lib/motion"
import { useSwitchSpring } from "@renderer/lib/useMotion"
import GoogleCalendarSetupWizard from "./GoogleCalendarSetupWizard"
import JiraSetupWizard from "./JiraSetupWizard"
import FigmaSetupWizard from "./FigmaSetupWizard"
import GithubSetupWizard, { GithubDetail } from "./GithubSetupWizard"
import TicketLinksSettings from "./TicketLinksSettings"
import AiSetupWizard from "./AiSetupWizard"
import UpcomingConnectorGuide from "./ConnectorGuides"
import AiEnabledSection from "./AiEnabledSection"
import AccessibilitySection from "./AccessibilitySection"
import VocabularySection from "./VocabularySection"
import AccountList from "./AccountList"
import RoleSection from "./RoleSection"
import "./settings.css"

interface SettingsModalProps {
  onClose: () => void
  /** Section affichée à l'ouverture (ex. clic sur une notification de test). */
  initialSection?: SettingsSectionId
}

interface UnimplementedRow {
  id: UpcomingConnectorId
  letter: string
  color: string
  name: string
  subtitle: string
}

export type SettingsSectionId = "accounts" | "connectors" | "ai" | "vocabulary" | "accessibility"

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; navLabel: string; icon: React.JSX.Element }[] = [
  {
    id: "accounts",
    label: "Comptes",
    navLabel: "Comptes",
    icon: (
      <svg {...SVG_PROPS}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </svg>
    ),
  },
  {
    id: "connectors",
    label: "Connecteurs",
    navLabel: "Connecteurs",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4" />
      </svg>
    ),
  },
  {
    id: "ai",
    label: "Intelligence artificielle",
    navLabel: "IA",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
      </svg>
    ),
  },
  {
    id: "vocabulary",
    label: "Vocabulaire des réunions",
    navLabel: "Vocabulaire",
    icon: (
      <svg {...SVG_PROPS}>
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13M9 8h6M9 12h4" />
      </svg>
    ),
  },
  {
    id: "accessibility",
    label: "Accessibilité",
    navLabel: "Accessibilité",
    icon: (
      <svg {...SVG_PROPS}>
        <circle cx="12" cy="4.5" r="1.8" />
        <path d="M5 8.5l7 1.5 7-1.5M12 10v5m0 0l-3 6m3-6l3 6" />
      </svg>
    ),
  },
]

/** Sources sans backend réel pour l'instant (voir docs/backlog : E3 Slack, D2 Teams/Outlook). */
const UNIMPLEMENTED_ROWS: UnimplementedRow[] = [
  { id: "slack", letter: "S", color: "#611F69", name: "Slack", subtitle: "Fils de discussion et notifications" },
  { id: "teams", letter: "T", color: "#5B5FC7", name: "Microsoft Teams", subtitle: "Réunions et messages" },
  { id: "outlook", letter: "O", color: "#0364B8", name: "Outlook", subtitle: "Agenda et e-mails" },
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

/**
 * Consentement au partage du journal et des décisions avec l'IA (contrat
 * docs/ipc/assistant-context-privacy.md). L'interrupteur n'affiche que l'état
 * persisté renvoyé par main : jamais de valeur par défaut ni d'état optimiste.
 */
function PrivacySection(): React.JSX.Element {
  const [settings, setSettings] = useState<PrivacySettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // La modale peut se fermer pendant un appel IPC : on ignore alors la réponse.
  const mountedRef = useRef(true)
  const switchRef = useRef<HTMLButtonElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  // Quand l'élément focalisé disparaît (interrupteur démonté, « Réessayer » retiré),
  // le focus doit être déplacé explicitement, sinon il retombe sur <body>.
  const [pendingFocus, setPendingFocus] = useState<"switch" | "retry" | null>(null)

  useEffect(() => {
    if (!pendingFocus) return
    const target = pendingFocus === "switch" ? switchRef.current : retryRef.current
    if (target) {
      target.focus()
      setPendingFocus(null)
    }
  }, [pendingFocus, settings, loadError])

  function load(): void {
    if (loading) return
    const retryHadFocus = retryRef.current !== null && document.activeElement === retryRef.current
    setLoading(true)
    window.api.privacy
      .get()
      .then((result) => {
        if (!mountedRef.current) return
        // L'erreur n'est effacée qu'au succès : « Réessayer » reste monté (et focalisé) pendant l'appel.
        setLoadError(null)
        setSettings(result)
        if (retryHadFocus) setPendingFocus("switch")
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setLoadError(cleanIpcErrorMessage(err))
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => {
      mountedRef.current = false
    }
    // Chargement initial uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleToggle(): Promise<void> {
    if (!settings || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const persisted = await window.api.privacy.setShareRecentActivity(!settings.shareRecentActivityWithAi)
      if (!mountedRef.current) return
      setSettings(persisted)
      playSfx("tick")
    } catch (err) {
      if (!mountedRef.current) return
      setSaveError(cleanIpcErrorMessage(err))
      // Retour à l'état réellement persisté : l'écriture a pu échouer après un changement partiel.
      try {
        const persisted = await window.api.privacy.get()
        if (mountedRef.current) setSettings(persisted)
      } catch (reloadErr) {
        if (mountedRef.current) {
          const switchHadFocus = switchRef.current !== null && document.activeElement === switchRef.current
          setSettings(null)
          setLoadError(cleanIpcErrorMessage(reloadErr))
          // L'interrupteur va être démonté : le focus passe sur « Réessayer » plutôt que dans le vide.
          if (switchHadFocus) setPendingFocus("retry")
        }
      }
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const checked = settings?.shareRecentActivityWithAi ?? false
  // Le pouce glisse en ressort et s'étire sous la vitesse ; la piste change de couleur avec lui.
  useSwitchSpring(switchRef, checked, settings !== null)

  return (
    <>
      <p className="settings-section-label">Confidentialité</p>
      <div className="settings-row settings-privacy-row">
        <div className="settings-row-info">
          <label className="settings-privacy-label" htmlFor="settings-privacy-share" id="settings-privacy-share-label">
            Partager mon activité récente (journal, décisions) avec l&apos;IA
          </label>
        </div>
        {settings ? (
          <button
            id="settings-privacy-share"
            type="button"
            role="switch"
            aria-checked={checked}
            aria-labelledby="settings-privacy-share-label"
            aria-describedby="settings-privacy-share-help"
            // Pas de `disabled` : Chromium retirerait le focus clavier du bouton à chaque bascule.
            // La garde `if (saving) return` de handleToggle bloque les déclenchements concurrents.
            ref={switchRef}
            aria-busy={saving}
            aria-disabled={saving}
            className={"settings-switch" + (checked ? " settings-switch--on" : "")}
            onClick={() => void handleToggle()}
          >
            <span className="settings-switch-thumb" aria-hidden="true" />
          </button>
        ) : (
          !loadError && (
            <span className="settings-detail-hint" role="status">
              Lecture du réglage…
            </span>
          )
        )}
      </div>
      <div className="settings-privacy-help" id="settings-privacy-share-help">
        <p className="settings-detail-hint settings-privacy-text">
          Activé : votre journal d&apos;hier et vos décisions de réunion récentes sont envoyés à votre fournisseur
          d&apos;IA avec vos questions à BCC.
        </p>
        <p className="settings-detail-hint settings-privacy-text">
          Désactivé : les suggestions basées sur votre journal et vos réunions disparaissent, seules celles basées sur
          vos tickets Jira restent disponibles.
        </p>
      </div>
      {loadError && (
        <div className="settings-privacy-help">
          <p className="settings-detail-error" role="alert">
            Impossible de lire le réglage de confidentialité : {loadError}
          </p>
          <button
            ref={retryRef}
            type="button"
            className="settings-connect-button"
            aria-busy={loading}
            aria-disabled={loading}
            onClick={load}
          >
            Réessayer
          </button>
        </div>
      )}
      {saveError && (
        <div className="settings-privacy-help">
          <p className="settings-detail-error" role="alert">
            Le réglage n&apos;a pas été enregistré : {saveError}
          </p>
        </div>
      )}
    </>
  )
}

/**
 * Raccourcis personnels appris localement (contrat : docs/ipc/personal-vocabulary.md).
 * Ils restent sur l'appareil ; « Oublier » les efface tous. Rien de ce qui est affiché
 * ici n'est envoyé à un service externe.
 */
function ShortcutsSection(): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.api.vocabulary
      .list()
      .then((list) => {
        if (mountedRef.current) setCount(list.length)
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setError(cleanIpcErrorMessage(err))
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function handleForget(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await window.api.vocabulary.forget()
      if (mountedRef.current) setCount(0)
    } catch (err) {
      if (mountedRef.current) setError(cleanIpcErrorMessage(err))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const countLabel = count === null ? "—" : count === 0 ? "Aucun" : `${count} ${count > 1 ? "raccourcis" : "raccourci"}`

  return (
    <>
      <p className="settings-section-label">Raccourcis personnels</p>
      <div className="settings-row">
        <div className="settings-row-info">
          <p className="settings-privacy-label">Raccourcis appris sur cet appareil</p>
        </div>
        <span className="settings-detail-hint">{countLabel}</span>
      </div>
      <div className="settings-privacy-help">
        <p className="settings-detail-hint settings-privacy-text">
          Quand vous choisissez une suggestion, BCC retient votre formulation pour la proposer en premier la
          prochaine fois. Cet apprentissage reste sur cet appareil et n&apos;est jamais envoyé à votre
          fournisseur d&apos;IA.
        </p>
        {count !== null && count > 0 && (
          <button
            type="button"
            className="settings-connect-button"
            aria-busy={busy}
            aria-disabled={busy}
            onClick={() => void handleForget()}
          >
            {busy ? "Suppression…" : "Oublier"}
          </button>
        )}
        {error && (
          <p className="settings-detail-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  )
}

function SettingsModal({ onClose, initialSection = "connectors" }: SettingsModalProps): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null)
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null)
  const [version, setVersion] = useState("")
  const [section, setSection] = useState<SettingsSectionId>(initialSection)
  const [expandedId, setExpandedId] = useState<ConnectorSummary["id"] | null>(null)
  // Connecteur dont l'assistant de connexion est ouvert dans la modale (Jira, IA, Figma, GitHub, ou Google Agenda).
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

  // Le bouton qui a ouvert la modale est rendu inerte pendant qu'elle est ouverte : on lui rend le focus à la fermeture.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      // Après le commit qui retire `inert`, sinon le focus est refusé.
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus()
      })
    }
  }, [])

  // Ouverture : le voile s'assombrit, la fenêtre éclot (ressort rebondissant).
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const modal = modalRef.current
    if (!overlay || !modal || prefersReducedMotion()) return
    overlay.style.opacity = "0"
    modal.style.scale = "0.93"
    modal.style.translate = "0 10px"
    const fade = spring(0, 1, SPRINGS.snappy, (p) => (overlay.style.opacity = p === 1 ? "" : String(Math.min(1, p))))
    const grow = spring(0, 1, SPRINGS.bouncy, (p) => {
      modal.style.scale = p === 1 ? "" : (0.93 + p * 0.07).toFixed(4)
      modal.style.translate = p === 1 ? "" : `0 ${((1 - p) * 10).toFixed(1)}px`
    })
    return () => {
      fade.stop()
      grow.stop()
    }
  }, [])

  /** Fermeture : la fenêtre se resserre et le voile s'efface, puis la modale est démontée. */
  function requestClose(): void {
    const overlay = overlayRef.current
    const modal = modalRef.current
    if (closingRef.current) return
    closingRef.current = true
    if (!overlay || !modal || prefersReducedMotion()) {
      onClose()
      return
    }
    spring(1, 0, SPRINGS.snappy, (p) => (overlay.style.opacity = String(Math.max(0, p))))
    spring(1, 0.93, SPRINGS.snappy, (p, v) => {
      modal.style.scale = p.toFixed(4)
      if (v === 0) onClose()
    })
  }

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
    github: () => setWizardId("github"),
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
    if (id === "github") return <GithubDetail onRotated={onRotated} />
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
    if (id === "github") return <GithubSetupWizard onConnected={handleWizardConnected} onCancel={onCancel} />
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

  const activeSection = SETTINGS_SECTIONS.find((entry) => entry.id === section) ?? SETTINGS_SECTIONS[0]

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={requestClose}>
      <div
        className="settings-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="settings-sidebar" aria-label="Sections des réglages">
          <h2 className="settings-title" id="settings-title">
            Réglages
          </h2>
          {SETTINGS_SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="settings-nav"
              aria-label={entry.label}
              title={entry.label}
              aria-current={entry.id === section ? "page" : undefined}
              onClick={() => setSection(entry.id)}
            >
              {entry.icon}
              <span className="settings-nav-label">{entry.navLabel}</span>
              {entry.id === "connectors" && connectedRows.length > 0 && (
                <span className="settings-nav-badge">{connectedRows.length}</span>
              )}
            </button>
          ))}
          <div className="settings-sidebar-foot">
            <span className="settings-footer-lock">
              🔒 {encryptionAvailable ? "Clés chiffrées sur cet appareil" : "Chiffrement indisponible sur cet appareil"}
            </span>
            <span>BCC {version}</span>
          </div>
        </nav>

        <div className="settings-main">
          <div className="settings-header">
            <h3 className="settings-section-title">{activeSection.label}</h3>
            <button type="button" className="settings-close" onClick={requestClose} aria-label="Fermer">
              ✕
            </button>
          </div>

          <div className="settings-panel" key={section}>
            {section === "accounts" && (
              <>
                <RoleSection />
                <AccountList showSignOut />
              </>
            )}

            {section === "connectors" && (
              <>
                {connectedRows.length > 0 && (
                  <>
                    <p className="settings-section-label">Connecté</p>
                    {connectedRows.map(renderConnectorRow)}
                  </>
                )}

                <p className="settings-section-label">Ajouter une source</p>
                {disconnectedRows.map(renderConnectorRow)}
                {UNIMPLEMENTED_ROWS.map(renderUnimplementedRow)}

                <TicketLinksSettings
                  githubConnected={connectedRows.some((row) => row.id === "github")}
                  figmaConnected={connectedRows.some((row) => row.id === "figma")}
                />
              </>
            )}

            {section === "ai" && (
              <>
                <AiEnabledSection />
                <PrivacySection />
                <ShortcutsSection />
              </>
            )}

            {section === "vocabulary" && <VocabularySection />}

            {section === "accessibility" && <AccessibilitySection />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
