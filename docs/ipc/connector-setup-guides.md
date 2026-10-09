# Contrat IPC — Guides de connexion des connecteurs

> Ajouté le 27/09/2026. Complète `docs/ipc/google-calendar-credentials.md` (E4bis) en
> étendant le même pattern d'assistant guidé aux autres connecteurs de l'écran Réglages.

## Pourquoi

L'assistant Google Agenda (E4bis) a introduit un **guide pas-à-pas** : étapes numérotées,
bouton « Ouvrir ↗ » par étape, puis champs de saisie et « Tester la connexion ». Ce contrat
généralise ce pattern aux autres connecteurs de D1/D2 :

- **Jira, IA, Figma** — connecteurs réellement branchés : l'assistant remplace le renvoi
  vers l'onboarding quand on clique « Connecter » sur une rangée déconnectée. On se connecte
  donc entièrement depuis Réglages.
- **Slack, Teams, Outlook** — annoncés mais sans backend (E3, D2) : un lien
  « Voir comment faire » déplie un guide **informatif** (étapes + liens, sans champs ni
  bouton de connexion). Tant que l'intégration n'existe pas, rien ne pourrait être vérifié
  ni enregistré ; le bouton « Connecter » reste désactivé (« Bientôt disponible »).

## Types partagés (`src/shared/connectors.ts`)

```ts
export type ConnectableConnectorId = "jira" | "ai" | "figma" | "calendar" | "github"
export type UpcomingConnectorId = "slack" | "teams" | "outlook"

/** Pages d'aide ouvrables depuis les guides des connecteurs sans backend. */
export type ConnectorSetupPage = "slackCreateApp" | "microsoftEntraApps"

export const CONNECTOR_SETUP_PAGES: readonly ConnectorSetupPage[]
```

`ConnectorSummary.id` reste limité aux connecteurs branchés (`ConnectableConnectorId`) :
il vient de `settings:listConnectors`. Les connecteurs à venir ne sont pas des résumés
renvoyés par le main, seulement des rangées statiques du renderer.

## Canal

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `connectors:openSetupPage` | `settings.openSetupPage(page)` | `ConnectorSetupPage` | `void`. Main valide contre la liste blanche ; l'URL n'est **jamais** fournie par le renderer. |

Les guides Jira / IA / Figma réutilisent les canaux existants (`jira:openTokenPage`,
`ai:openKeyPage(provider)`, `figma:openTokenPage`), qui portent déjà l'URL côté main.
Le nouveau canal ne couvre donc que les connecteurs sans intégration.

## Règles

- **Aucune URL dans le renderer** : `src/main/connectors/setup-pages.ts` est la seule source
  des adresses (`SETUP_PAGE_URLS`), et `assertConnectorSetupPage` (dans `src/main/index.ts`)
  rejette tout identifiant inconnu avec `Paramètre "page" invalide.` — vérifié au runtime
  sur `"https://evil.example"`, `"toString"` et une valeur non-chaîne.
- **Aucun secret** : ce canal n'en transporte ni ne manipule aucun. Les étapes « Ouvrir ↗ »
  ouvrent le navigateur système via `shell.openExternal`, jamais une `BrowserWindow` interne.
- **Frontière de sécurité inchangée** : `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`. Le renderer ne voit que `window.api`.

## Rendu

`src/renderer/src/screens/settings/SetupWizard.tsx` est la coquille commune (étapes +
champs + actions + état d'attente) utilisée par `GoogleCalendarSetupWizard`,
`JiraSetupWizard`, `FigmaSetupWizard`, `AiSetupWizard` et `ConnectorGuides`. Les classes
CSS sont préfixées `.setup-wizard-*` (ex-`.gcal-wizard-*`).

L'étape d'onboarding Google Agenda (`ConnectCalendarStep`) réutilise
`GoogleCalendarSetupWizard` : même guide à la configuration initiale et depuis Réglages.
