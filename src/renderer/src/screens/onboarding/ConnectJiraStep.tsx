import { useEffect, useState } from "react"
import { guessJiraDomain } from "@shared/jira"
import type { JiraConnectionStatus, JiraProjectSummary } from "@shared/jira"
import OnboardingHeader from "./OnboardingHeader"
import { playSetupSound } from "@renderer/lib/sound"
import "./onboarding.css"

/** `ipcRenderer.invoke` préfixe tout rejet avec "Error invoking remote method '<canal>': " : on l'enlève pour l'UI. */
function cleanIpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

interface ConnectJiraStepProps {
  /** E-mail professionnel saisi à l'étape A1, utilisé pour l'auth Jira et la suggestion de domaine. */
  email: string
  onBack?: () => void
  onContinue: (status: JiraConnectionStatus) => void
}

type Phase = "idle" | "connecting" | "connected"

function ConnectJiraStep({ email, onBack, onContinue }: ConnectJiraStepProps): React.JSX.Element {
  const [domain, setDomain] = useState(() => guessJiraDomain(email))
  const [domainEditable, setDomainEditable] = useState(false)
  const [showManualToken, setShowManualToken] = useState(false)
  const [token, setToken] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState<JiraConnectionStatus | null>(null)
  const [projects, setProjects] = useState<JiraProjectSummary[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Jira déjà connecté (jeton conservé chiffré) : on le reprend sans redemander domaine ni jeton, mais seulement
  // une fois Jira réellement joint (liste des projets). Sinon l'erreur est affichée et le formulaire reste disponible.
  useEffect(() => {
    let cancelled = false
    async function resume(): Promise<void> {
      try {
        const existing = await window.api.jira.getStatus()
        if (cancelled || !existing.connected) return
        if (existing.domain) setDomain(existing.domain)
        try {
          const projectList = await window.api.jira.listProjects()
          if (cancelled) return
          setStatus(existing)
          setPhase("connected")
          setProjects(projectList)
          setSelectedProjectId(projectList[0]?.id ?? "")
        } catch (err) {
          if (!cancelled) {
            setError(`Jira est enregistré mais ne répond pas : ${cleanIpcErrorMessage(err)} Reconnectez-le avec un nouveau jeton.`)
          }
        }
      } catch (err) {
        if (!cancelled) setError(`Impossible de lire la connexion Jira enregistrée : ${cleanIpcErrorMessage(err)}`)
      }
    }
    void resume()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreateToken(): Promise<void> {
    await window.api.jira.openTokenPage()
    setShowManualToken(true)
  }

  async function handleConnect(): Promise<void> {
    if (!domain || !token) return
    setPhase("connecting")
    setError(null)
    try {
      const result = await window.api.jira.connect(domain, email, token)
      setStatus(result)
      setPhase("connected")
      playSetupSound("ok")
      const projectList = await window.api.jira.listProjects()
      setProjects(projectList)
      setSelectedProjectId(projectList[0]?.id ?? "")
    } catch (err) {
      setPhase("idle")
      setError(cleanIpcErrorMessage(err))
      playSetupSound("err")
    }
  }

  async function handleDisconnect(): Promise<void> {
    await window.api.jira.disconnect()
    setStatus(null)
    setPhase("idle")
    setToken("")
    setProjects([])
    setSelectedProjectId("")
  }

  async function handleContinue(): Promise<void> {
    if (!status) return
    const selectedProject = projects.find((project) => project.id === selectedProjectId)
    if (selectedProject) await window.api.jira.setDefaultProject(selectedProject.key)
    onContinue(status)
  }

  return (
    <div className="onboarding-screen">
      <section className="onboarding-step">
        <OnboardingHeader stepIndex={1} totalSteps={5} timeLabel="2 min" />
        <div className="onboarding-icon onboarding-icon--jira" aria-hidden="true">
          ⇄
        </div>
        <h1 className="onboarding-title">Connectez Jira.</h1>
        <p className="onboarding-subtitle">Pour lire vos tickets et poster les questions en commentaire.</p>

        <div className="onboarding-card">
          <div className="onboarding-card-row onboarding-card-row--domain">
            <span className="onboarding-domain-icon" aria-hidden="true">
              🌐
            </span>
            <div className="onboarding-domain-info">
              {domainEditable ? (
                <input
                  className="onboarding-input onboarding-input--inline"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  onBlur={() => setDomainEditable(false)}
                  autoFocus
                />
              ) : (
                <>
                  <span className="onboarding-domain-name">{domain || "Domaine introuvable"}</span>
                  <span className="onboarding-domain-hint">Trouvé à partir de votre e-mail</span>
                </>
              )}
            </div>
            {phase !== "connected" && (
              <button type="button" className="onboarding-link" onClick={() => setDomainEditable(true)}>
                Modifier
              </button>
            )}
          </div>

          {phase === "connected" && status ? (
            <div className="onboarding-connected">
              <div className="onboarding-card-row onboarding-card-row--success">
                <span className="onboarding-check" aria-hidden="true">
                  ✓
                </span>
                <span>Connecté en tant que {status.displayName ?? status.email}</span>
              </div>

              {projects.length > 0 && (
                <label className="onboarding-select-row">
                  <span aria-hidden="true">📁</span>
                  <select
                    className="onboarding-select"
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
              )}

              <button type="button" className="onboarding-link onboarding-link--muted" onClick={handleDisconnect}>
                Déconnecter
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="onboarding-button onboarding-button--accent" onClick={handleCreateToken}>
                Créer un jeton Jira ↗
              </button>

              <ol className="onboarding-checklist">
                <li>
                  <span className="onboarding-checklist-index">1</span>« Créer un jeton d&apos;API »
                </li>
                <li>
                  <span className="onboarding-checklist-index">2</span>Nommez-le « Byko »
                </li>
                <li>
                  <span className="onboarding-checklist-index">3</span>Cliquez « Copier »
                </li>
              </ol>

              <p className="onboarding-hint">Collez le jeton ci-dessous une fois copié.</p>

              {!showManualToken ? (
                <button type="button" className="onboarding-link" onClick={() => setShowManualToken(true)}>
                  Coller le jeton moi-même
                </button>
              ) : (
                <>
                  <button type="button" className="onboarding-link" onClick={() => setShowManualToken(false)}>
                    Masquer
                  </button>
                  <input
                    className="onboarding-input"
                    type="password"
                    placeholder="Collez le jeton ici"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    onPaste={() => playSetupSound("tick")}
                  />
                </>
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
          {phase === "connected" ? (
            <button
              type="button"
              className="onboarding-button onboarding-button--primary"
              onClick={() => void handleContinue()}
            >
              Continuer
            </button>
          ) : (
            <button
              type="button"
              className="onboarding-button onboarding-button--primary"
              disabled={!domain || !token || phase === "connecting"}
              onClick={handleConnect}
            >
              {phase === "connecting" ? "Vérification…" : "Continuer"}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

export default ConnectJiraStep
