import type { ReactNode } from "react"
import type { UpcomingConnectorId } from "@shared/connectors"
import SetupWizard from "./SetupWizard"
import type { SetupWizardStep } from "./SetupWizard"
import "./settings.css"

interface ConnectorGuide {
  title: string
  intro: ReactNode
  steps: SetupWizardStep[]
}

const NOT_AVAILABLE_YET =
  "Byko ne se connecte pas encore à ce service : rien à préparer aujourd'hui. Voici la marche à suivre qui sera nécessaire."

/**
 * Guides des connecteurs annoncés dans Réglages mais sans backend (E3, D2).
 * Volontairement dépourvus de champs et de bouton de connexion : tant que
 * l'intégration n'existe pas, rien ne pourrait être vérifié ni enregistré.
 * Les liens passent par `settings.openSetupPage`, qui résout l'URL côté main
 * depuis une liste blanche (voir `docs/ipc/connector-setup-guides.md`).
 */
const GUIDES: Record<UpcomingConnectorId, ConnectorGuide> = {
  slack: {
    title: "Comment connecter Slack",
    intro: NOT_AVAILABLE_YET,
    steps: [
      {
        title: "Ouvrir la page des applications Slack",
        body: <>Connectez-vous, puis cliquez « Create New App » → « From scratch ».</>,
        open: () => window.api.settings.openSetupPage("slackCreateApp"),
      },
      {
        title: "Choisir l'espace de travail",
        body: <>Sélectionnez l&apos;espace dont Byko devra lire les fils de discussion.</>,
      },
      {
        title: "Autoriser la lecture des fils et des messages",
        body: (
          <>
            Byko demandera ces permissions par OAuth, comme pour Google Agenda : aucune clé à
            copier-coller.
          </>
        ),
      },
    ],
  },
  teams: {
    title: "Comment connecter Microsoft Teams",
    intro: NOT_AVAILABLE_YET,
    steps: [
      {
        title: "Ouvrir les inscriptions d'applications Microsoft Entra",
        body: <>Connectez-vous avec votre compte professionnel Microsoft 365.</>,
        open: () => window.api.settings.openSetupPage("microsoftEntraApps"),
      },
      {
        title: "Enregistrer une application pour Byko",
        body: <>Nom libre, puis créez un secret client — il sera saisi dans Byko, jamais partagé.</>,
      },
      {
        title: "Autoriser les permissions Microsoft Graph",
        body: <>Réunions et messages en lecture, demandés par OAuth.</>,
      },
    ],
  },
  outlook: {
    title: "Comment connecter Outlook",
    intro: NOT_AVAILABLE_YET,
    steps: [
      {
        title: "Ouvrir les inscriptions d'applications Microsoft Entra",
        body: <>Connectez-vous avec votre compte professionnel Microsoft 365.</>,
        open: () => window.api.settings.openSetupPage("microsoftEntraApps"),
      },
      {
        title: "Enregistrer une application pour Byko",
        body: <>Nom libre, puis créez un secret client — il sera saisi dans Byko, jamais partagé.</>,
      },
      {
        title: "Autoriser les permissions Microsoft Graph",
        body: <>Agenda et courrier en lecture.</>,
      },
    ],
  },
}

function UpcomingConnectorGuide({ id }: { id: UpcomingConnectorId }): React.JSX.Element {
  const guide = GUIDES[id]
  return <SetupWizard title={guide.title} intro={guide.intro} steps={guide.steps} />
}

export default UpcomingConnectorGuide
