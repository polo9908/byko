import { useEffect, useState } from "react"
import { getProviderMeta } from "@shared/ai"
import type { AIConnectionStatus } from "@shared/ai"
import type { JiraConnectionStatus } from "@shared/jira"
import type { FigmaConnectionStatus } from "@shared/figma"
import type { GoogleCalendarConnectionStatus } from "@shared/googleCalendar"
import OnboardingHeader from "./OnboardingHeader"
import "./onboarding.css"

interface SummaryStepProps {
  onBack?: () => void
  onFinish: () => void
}

/**
 * Étape A5 « Tout est en place. », fidèle au prototype : récapitulatif des
 * connexions avec pastille verte/grise (Jira, IA, Figma, Google Agenda).
 */
function SummaryStep({ onBack, onFinish }: SummaryStepProps): React.JSX.Element {
  const [jiraStatus, setJiraStatus] = useState<JiraConnectionStatus | null>(null)
  const [aiStatus, setAiStatus] = useState<AIConnectionStatus | null>(null)
  const [figmaStatus, setFigmaStatus] = useState<FigmaConnectionStatus | null>(null)
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarConnectionStatus | null>(null)

  useEffect(() => {
    window.api.jira.getStatus().then(setJiraStatus)
    window.api.ai.getStatus().then(setAiStatus)
    window.api.figma.getStatus().then(setFigmaStatus)
    window.api.calendar.getStatus().then(setCalendarStatus)
  }, [])

  const aiMeta = aiStatus?.provider ? getProviderMeta(aiStatus.provider) : null

  return (
    <div className="onboarding-screen">
      <section className="onboarding-step">
        <OnboardingHeader stepIndex={5} totalSteps={5} timeLabel="35 s" />

        <h1 className="onboarding-title">Tout est en place.</h1>

        <div className="onboarding-card onboarding-card--rows">
          <div className="onboarding-recap-row">
            <span className="onboarding-recap-icon" style={{ background: "#0052CC" }}>
              J
            </span>
            <div className="onboarding-recap-info">
              <span className="onboarding-recap-name">Jira</span>
              <span className="onboarding-recap-subtitle">
                {jiraStatus?.connected ? `${jiraStatus.domain} · ${jiraStatus.email}` : "Non connecté"}
              </span>
            </div>
            <span
              className={"onboarding-recap-dot" + (jiraStatus?.connected ? "" : " onboarding-recap-dot--muted")}
              aria-hidden="true"
            />
          </div>

          <div className="onboarding-recap-row">
            <span className="onboarding-recap-icon" style={{ background: aiMeta?.color ?? "#C15F3C" }}>
              {aiMeta?.letter ?? "A"}
            </span>
            <div className="onboarding-recap-info">
              <span className="onboarding-recap-name">{aiMeta?.label ?? "IA"}</span>
              <span className="onboarding-recap-subtitle">
                {aiStatus?.connected ? `Connecté · ${aiStatus.maskedKey}` : "Non connecté"}
              </span>
            </div>
            <span
              className={"onboarding-recap-dot" + (aiStatus?.connected ? "" : " onboarding-recap-dot--muted")}
              aria-hidden="true"
            />
          </div>

          <div className="onboarding-recap-row">
            <span className="onboarding-recap-icon" style={{ background: "#1E1E1E" }}>
              F
            </span>
            <div className="onboarding-recap-info">
              <span className="onboarding-recap-name">Figma</span>
              <span className="onboarding-recap-subtitle">
                {figmaStatus?.connected ? (figmaStatus.handle ?? figmaStatus.email) : "Plus tard, depuis Paramètres"}
              </span>
            </div>
            <span
              className={"onboarding-recap-dot" + (figmaStatus?.connected ? "" : " onboarding-recap-dot--muted")}
              aria-hidden="true"
            />
          </div>

          <div className="onboarding-recap-row">
            <span className="onboarding-recap-icon" style={{ background: "#1A73E8" }}>
              G
            </span>
            <div className="onboarding-recap-info">
              <span className="onboarding-recap-name">Google Agenda</span>
              <span className="onboarding-recap-subtitle">
                {calendarStatus?.connected ? calendarStatus.email : "Plus tard, depuis Réglages"}
              </span>
            </div>
            <span
              className={"onboarding-recap-dot" + (calendarStatus?.connected ? "" : " onboarding-recap-dot--muted")}
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="onboarding-actions">
          {onBack ? (
            <button type="button" className="onboarding-link onboarding-link--muted" onClick={onBack}>
              Retour
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="onboarding-button onboarding-button--primary" onClick={onFinish}>
            Terminer
          </button>
        </div>
      </section>
    </div>
  )
}

export default SummaryStep
