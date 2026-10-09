import * as jira from "../integrations/jira"
import * as aiProvider from "../integrations/ai-provider"
import * as figma from "../integrations/figma"
import * as googleCalendar from "../integrations/google-calendar"
import * as github from "../integrations/github"
import { getProviderMeta } from "../../shared/ai"
import type { ConnectorSummary } from "../../shared/connectors"

/**
 * Registre générique des connecteurs (ticket E7). Chaque intégration garde
 * sa propre API riche (E1/E2/E5) pour les écrans d'onboarding ; ce module
 * ne fait qu'agréger un résumé uniforme pour l'écran Réglages (D1), qui n'a
 * ainsi qu'un seul appel à faire au lieu d'un par intégration.
 */
export async function listConnectors(): Promise<ConnectorSummary[]> {
  const [jiraStatus, aiStatus, figmaStatus, calendarStatus, githubStatus] = await Promise.all([
    jira.getStatus(),
    aiProvider.getStatus(),
    figma.getStatus(),
    googleCalendar.getStatus(),
    github.getStatus(),
  ])

  const aiMeta = aiStatus.provider ? getProviderMeta(aiStatus.provider) : null

  return [
    {
      id: "jira",
      label: "Jira",
      letter: "J",
      color: "#0052CC",
      connected: jiraStatus.connected,
      detail: jiraStatus.connected ? `${jiraStatus.domain} · ${jiraStatus.email}` : undefined,
    },
    {
      id: "ai",
      label: aiMeta?.label ?? "IA",
      letter: aiMeta?.letter ?? "A",
      color: aiMeta?.color ?? "#C15F3C",
      connected: aiStatus.connected,
      detail: aiStatus.connected ? aiStatus.maskedKey : undefined,
    },
    {
      id: "figma",
      label: "Figma",
      letter: "F",
      color: "#1E1E1E",
      connected: figmaStatus.connected,
      detail: figmaStatus.connected ? (figmaStatus.handle ?? figmaStatus.email) : undefined,
    },
    {
      id: "calendar",
      label: "Google Agenda",
      letter: "G",
      color: "#1A73E8",
      connected: calendarStatus.connected,
      detail: calendarStatus.connected ? calendarStatus.email : undefined,
    },
    {
      id: "github",
      label: "GitHub",
      letter: "G",
      color: "#1E1E1E",
      connected: githubStatus.connected,
      detail: githubStatus.connected ? githubStatus.login : undefined,
    },
  ]
}
