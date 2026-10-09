import { useEffect, useRef, useState } from "react"
import type { ClipboardEvent, ReactNode } from "react"
import { GOOGLE_CALENDAR_SETUP_PAGES } from "@shared/googleCalendar"
import type { GoogleCalendarConnectionStatus, GoogleCalendarSetupPage } from "@shared/googleCalendar"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import SetupWizard from "./SetupWizard"
import "./settings.css"

interface GoogleCalendarSetupWizardProps {
  onConnected: (status: GoogleCalendarConnectionStatus) => void
  onCancel?: () => void
}

interface SetupStep {
  title: string
  body: ReactNode
}

/**
 * Libellés alignés sur la Google Cloud Console actuelle (Google Auth Platform).
 * `Record` exhaustif : une page ajoutée au contrat sans texte ici casse le typecheck.
 */
const SETUP_STEPS: Record<GoogleCalendarSetupPage, SetupStep> = {
  createProject: {
    title: "Créer un projet",
    body: (
      <>
        Donnez-lui un nom libre (par exemple « Byko perso »), cliquez « Créer », puis vérifiez
        qu&apos;il est bien sélectionné en haut de la console.
      </>
    ),
  },
  enableApi: {
    title: "Activer l'API Google Calendar",
    body: <>Cliquez « Activer ».</>,
  },
  consentScreen: {
    title: "Configurer l'écran de consentement",
    body: (
      <>
        Cliquez « Commencer », puis renseignez le nom de l&apos;application (par exemple « Byko »)
        et votre e-mail d&apos;assistance. Audience : <strong>Externe</strong>. Indiquez votre
        e-mail de contact, acceptez les conditions, puis « Créer ». Laissez l&apos;application en
        mode Test : ne la publiez pas.
      </>
    ),
  },
  testUsers: {
    title: "Vous ajouter comme utilisateur test",
    body: <>Ajoutez votre propre adresse Google dans les utilisateurs test, puis enregistrez.</>,
  },
  createClient: {
    title: "Créer l'identifiant client",
    body: (
      <>
        Type d&apos;application : <strong>Application de bureau</strong>, nom libre, puis « Créer ».
        Copiez tout de suite le Client ID et le Client Secret : le secret n&apos;est affiché en
        entier qu&apos;à ce moment. Pour éviter les erreurs de recopie, cliquez plutôt « Télécharger
        le JSON », ouvrez le fichier et collez tout son contenu dans l&apos;un des champs ci-dessous
        : les deux sont remplis automatiquement.
      </>
    ),
  },
}

/**
 * Le JSON téléchargé depuis la console a la forme `{ "installed": { "client_id", "client_secret", … } }`.
 * Le parser ici évite la recopie manuelle du secret, cause d'erreurs 401 déjà constatée.
 */
type ParsedClientJson =
  | { kind: "desktop"; clientId: string; clientSecret: string }
  | { kind: "wrongType" }
  | { kind: "notJson" }

function parseClientJson(text: string): ParsedClientJson {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return { kind: "notJson" }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Pas du JSON valide : c'est un collage ordinaire, rien à signaler.
    return { kind: "notJson" }
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "notJson" }
  const record = parsed as Record<string, unknown>
  // Un client « Application Web » a la clé `web` : il échouerait au retour OAuth en boucle locale.
  if ("web" in record && !("installed" in record)) return { kind: "wrongType" }
  const installed = record.installed
  if (typeof installed !== "object" || installed === null) return { kind: "notJson" }
  const { client_id: clientId, client_secret: clientSecret } = installed as Record<string, unknown>
  if (typeof clientId !== "string" || typeof clientSecret !== "string") return { kind: "notJson" }
  return { kind: "desktop", clientId: clientId.trim(), clientSecret: clientSecret.trim() }
}

function GoogleCalendarSetupWizard({
  onConnected,
  onCancel,
}: GoogleCalendarSetupWizardProps): React.JSX.Element {
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  const connectingRef = useRef(false)

  // Si l'assistant disparaît (modale fermée) pendant l'attente, on libère l'attente côté main :
  // sinon la tentative suivante serait refusée (« Une connexion Google est déjà en cours. »).
  useEffect(() => {
    return () => {
      if (connectingRef.current) {
        window.api.calendar.cancelConnect().catch((err: unknown) => {
          console.error("Annulation de la connexion Google impossible :", cleanIpcErrorMessage(err))
        })
      }
    }
  }, [])

  function handlePaste(event: ClipboardEvent<HTMLInputElement>): void {
    const parsed = parseClientJson(event.clipboardData.getData("text"))
    if (parsed.kind === "notJson") return
    event.preventDefault()
    if (parsed.kind === "wrongType") {
      setPasteNotice(null)
      setError(
        "Ce fichier correspond à un client « Application Web ». Recréez l'identifiant client avec le type « Application de bureau » (dernière étape).",
      )
      return
    }
    setClientId(parsed.clientId)
    setClientSecret(parsed.clientSecret)
    setError(null)
    setPasteNotice("Fichier JSON reconnu : Client ID et Client Secret remplis.")
  }

  async function handleTest(): Promise<void> {
    setConnecting(true)
    connectingRef.current = true
    setError(null)
    setPasteNotice(null)
    try {
      const status = await window.api.calendar.connectWithCredentials(clientId, clientSecret)
      setClientId("")
      setClientSecret("")
      onConnected(status)
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      connectingRef.current = false
      setConnecting(false)
      setCancelling(false)
    }
  }

  async function handleCancelConnect(): Promise<void> {
    setCancelling(true)
    try {
      // Le rejet de `connectWithCredentials` (« Connexion Google annulée. ») est affiché par handleTest.
      await window.api.calendar.cancelConnect()
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setCancelling(false)
    }
  }

  const canTest = !connecting && clientId.trim() !== "" && clientSecret.trim() !== ""

  return (
    <SetupWizard
      title="Connecter Google Agenda avec vos propres identifiants"
      intro={
        <>
          Byko est open source : aucune clé Google partagée n&apos;est intégrée à l&apos;application.
          Vous créez votre propre accès en 2 minutes environ, une seule fois. Il reste sous votre
          contrôle et n&apos;est enregistré que sur cet appareil.
        </>
      }
      steps={GOOGLE_CALENDAR_SETUP_PAGES.map((page) => ({
        title: SETUP_STEPS[page].title,
        body: SETUP_STEPS[page].body,
        open: () => window.api.calendar.openSetupPage(page),
      }))}
      error={error}
      waiting={
        connecting
          ? {
              title: "Vérification des identifiants puis autorisation dans votre navigateur…",
              body: (
                <>
                  Google affichera « Google n&apos;a pas validé cette application » : c&apos;est normal
                  pour votre propre client en mode Test. Cliquez « Continuer ».
                </>
              ),
              abortLabel: "Annuler",
              aborting: cancelling,
              onAbort: () => void handleCancelConnect(),
            }
          : undefined
      }
      submit={{ label: "Tester la connexion", disabled: !canTest, onClick: () => void handleTest() }}
      close={onCancel ? { label: "Fermer l'assistant", onClick: onCancel } : undefined}
    >
      <label className="setup-wizard-label">
        Client ID
        <input
          className="settings-detail-input settings-detail-input--mono"
          type="text"
          placeholder="…apps.googleusercontent.com"
          autoComplete="off"
          spellCheck={false}
          disabled={connecting}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          onPaste={handlePaste}
        />
      </label>
      <label className="setup-wizard-label">
        Client Secret
        <input
          className="settings-detail-input settings-detail-input--mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={connecting}
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          onPaste={handlePaste}
        />
      </label>
      {pasteNotice && <span className="settings-detail-hint">{pasteNotice}</span>}
    </SetupWizard>
  )
}

export default GoogleCalendarSetupWizard
