import { useState } from "react"
import type { JiraConnectionStatus, JiraProjectSummary } from "@shared/jira"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import SetupWizard from "./SetupWizard"
import "./settings.css"

interface JiraSetupWizardProps {
  onConnected: (status: JiraConnectionStatus) => void
  onCancel?: () => void
}

/**
 * Connexion Jira depuis Réglages : guide pas-à-pas vers la page des jetons
 * Atlassian, puis choix du projet par défaut (celui que B3 utilisera pour
 * créer les tickets pendant un point d'équipe — même logique qu'à l'étape
 * d'onboarding A2).
 */
function JiraSetupWizard({ onConnected, onCancel }: JiraSetupWizardProps): React.JSX.Element {
  const [domain, setDomain] = useState("")
  const [email, setEmail] = useState("")
  const [token, setToken] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<JiraConnectionStatus | null>(null)
  const [projects, setProjects] = useState<JiraProjectSummary[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [finishing, setFinishing] = useState(false)

  async function handleTest(): Promise<void> {
    setVerifying(true)
    setError(null)
    try {
      const result = await window.api.jira.connect(domain, email, token)
      setStatus(result)
      setToken("")
      const projectList = await window.api.jira.listProjects()
      setProjects(projectList)
      setSelectedProjectId(projectList[0]?.id ?? "")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  async function handleFinish(): Promise<void> {
    setFinishing(true)
    setError(null)
    try {
      const selected = projects.find((project) => project.id === selectedProjectId)
      if (selected) await window.api.jira.setDefaultProject(selected.key)
      if (status) onConnected(status)
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setFinishing(false)
    }
  }

  if (status) {
    return (
      <SetupWizard
        title={`Connecté en tant que ${status.displayName ?? status.email}`}
        intro={
          <>
            Dernière étape : choisissez le projet Jira qui recevra les tickets créés pendant vos points
            d&apos;équipe.
          </>
        }
        steps={[
          {
            title: "Choisir le projet par défaut",
            body: (
              <>
                C&apos;est ce projet que BYKO utilisera pour créer les tickets issus de vos réunions.
              </>
            ),
          },
        ]}
        error={error}
        submit={{
          label: finishing ? "Enregistrement…" : "Terminer",
          disabled: finishing || projects.length === 0,
          onClick: () => void handleFinish(),
        }}
        close={onCancel ? { label: "Fermer", onClick: onCancel } : undefined}
      >
        {projects.length > 0 ? (
          <label className="setup-wizard-label">
            Projet Jira
            <select
              className="setup-wizard-select"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.key} · {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="settings-detail-hint">
            Aucun projet accessible avec ce compte. Vérifiez que vous avez bien accès à au moins un projet Jira.
          </p>
        )}
      </SetupWizard>
    )
  }

  return (
    <SetupWizard
      title="Connecter Jira avec votre propre jeton"
      intro={
        <>
          BYKO ne stocke aucun jeton partagé : vous créez le vôtre et il n&apos;est enregistré,
          chiffré, que sur cet appareil.
        </>
      }
      steps={[
        {
          title: "Ouvrir vos jetons API Atlassian",
          body: <>Connectez-vous avec le compte Jira à relier, puis cliquez « Créer un jeton d&apos;API ».</>,
          open: () => window.api.jira.openTokenPage(),
        },
        {
          title: "Nommer le jeton « BCC »",
          body: <>Pour le retrouver facilement, puis validez par « Créer ».</>,
        },
        {
          title: "Copier le jeton et le coller ci-dessous",
          body: <>Atlassian ne l&apos;affiche qu&apos;une fois : copiez-le tout de suite.</>,
        },
      ]}
      error={error}
      submit={{
        label: verifying ? "Vérification…" : "Tester la connexion",
        disabled: verifying || domain.trim() === "" || email.trim() === "" || token.trim() === "",
        onClick: () => void handleTest(),
      }}
      close={onCancel ? { label: "Fermer l'assistant", onClick: onCancel } : undefined}
    >
      <label className="setup-wizard-label">
        Domaine Atlassian
        <input
          className="settings-detail-input"
          type="text"
          placeholder="acme.atlassian.net"
          autoComplete="off"
          spellCheck={false}
          disabled={verifying}
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
        />
      </label>
      <label className="setup-wizard-label">
        E-mail du compte Jira
        <input
          className="settings-detail-input"
          type="text"
          placeholder="vous@entreprise.com"
          autoComplete="off"
          spellCheck={false}
          disabled={verifying}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="setup-wizard-label">
        Jeton d&apos;API
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

export default JiraSetupWizard
