/**
 * BACK-4 — Traduit le document persisté (`lib/settings-store.ts`, jetons compris, sous forme
 * de `Secret`) vers `SettingsState` (`lib/types/settings.ts`), la forme exposée par
 * `GET /api/settings`, qui ne déclare aucun champ jeton.
 *
 * Construction champ par champ, jamais par spread ni par réutilisation d'un objet portant un
 * `apiToken` — `docs/api-contracts.md`, §Jetons. Aucune fonction ici ne lit `state.apiToken` :
 * ce n'est pas seulement une discipline, c'est vérifiable à la lecture (le champ n'apparaît
 * dans aucun retour de ce fichier).
 */

import type {
  PersistedAiState,
  PersistedFigmaState,
  PersistedJiraState,
  PersistedSettingsDocument,
} from "@/lib/settings-store";
import type {
  AiSettingsState,
  FigmaSettingsState,
  JiraSettingsState,
  SettingsState,
} from "@/lib/types/settings";

function mapError<TCode extends string>(
  error: { readonly message: string; readonly code?: TCode } | undefined,
): { message: string; code?: TCode } | undefined {
  if (error === undefined) {
    return undefined;
  }
  return error.code === undefined
    ? { message: error.message }
    : { message: error.message, code: error.code };
}

function mapJira(state: PersistedJiraState): JiraSettingsState {
  if (state.status === "connected") {
    return {
      status: "connected",
      instanceUrl: state.instanceUrl,
      email: state.email,
      account: { accountName: state.account.accountName },
    };
  }
  const lastError = mapError(state.lastError);
  return lastError === undefined
    ? { status: "not_connected" }
    : { status: "not_connected", lastError };
}

function mapFigma(state: PersistedFigmaState): FigmaSettingsState {
  if (state.status === "connected") {
    return state.account === undefined
      ? { status: "connected" }
      : { status: "connected", account: { accountName: state.account.accountName } };
  }
  if (state.status === "skipped") {
    return { status: "skipped" };
  }
  const lastError = mapError(state.lastError);
  return lastError === undefined
    ? { status: "not_connected" }
    : { status: "not_connected", lastError };
}

function mapAi(state: PersistedAiState): AiSettingsState {
  if (state.status === "connected") {
    return { status: "connected", provider: state.provider };
  }
  const lastError = mapError(state.lastError);
  return lastError === undefined
    ? { status: "not_connected" }
    : { status: "not_connected", lastError };
}

export function toSettingsState(document: PersistedSettingsDocument): SettingsState {
  return {
    jira: mapJira(document.jira),
    figma: mapFigma(document.figma),
    ai: mapAi(document.ai),
    onboardingCompleted: document.onboardingCompleted,
  };
}

/**
 * Premier lancement (coffre `absent`) : trois blocs `not_connected`, aucune cause connue,
 * onboarding non terminé.
 */
export function emptySettingsState(): SettingsState {
  return {
    jira: { status: "not_connected" },
    figma: { status: "not_connected" },
    ai: { status: "not_connected" },
    onboardingCompleted: false,
  };
}
