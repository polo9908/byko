/**
 * BACK-4 — Sauvegarde d'un bloc de connexion (`POST /api/settings`).
 *
 * Résout le point relevé à la lecture du contrat : `JiraSettingsState` en `connected` exige
 * `account.accountName`, et `AiSettingsState` en `connected` exige `provider` — or
 * `SaveSettingsRequest` ne transporte que des credentials, jamais de nom de compte. La seule
 * source non inventée pour `accountName` est le connecteur lui-même : ce module rejoue donc
 * le test de connexion (`testJiraConnection`/`testFigmaConnection`/`testAiConnection`, déjà
 * audités BACK-1/2/3) AVANT de persister, jamais après. Deux conséquences volontaires :
 * - la requête au provider est terminée avant tout appel à `store.update()` — aucun appel
 *   réseau n'entre dans la fonction `mutate` qu'attend `lib/token-storage.ts` ;
 * - un corps de requête portant des credentials jamais vérifiées ne peut jamais faire
 *   persister `status: "connected"` : la vérité vient du provider, pas du client.
 *
 * `lastError.message` persisté est TOUJOURS celui renvoyé par le test, jamais concaténé avec
 * le corps de requête ni recopié depuis un objet portant des credentials
 * (`docs/api-contracts.md`, §Risque résiduel).
 *
 * UN TEST RATÉ NE DÉGRADE PAS UNE CONNEXION DÉJÀ VALIDÉE (correctif d'audit du 04/09/2026) :
 * si le bloc est déjà `connected` dans le document lu, un nouvel échec de test le laisse
 * INTACT — jeton, compte, URL d'instance, e-mail, provider inchangés — et l'échec ne repart
 * que dans la réponse HTTP, jamais sur disque. Sans cela, un échec passager (jeton régénéré
 * côté provider, incident réseau, test au blur déclenché pendant l'édition d'un autre champ
 * du même bloc) détruisait sans récupération possible le `Secret` d'une connexion qui
 * fonctionnait, à rebours de l'US du ticket (« ne pas avoir à ressaisir mes jetons »). La
 * comparaison se fait DANS le `mutate` passé à `store.update()`, sur le document réellement
 * lu : un `store.read()` préalable rouvrirait une fenêtre de course entre lecture et écriture.
 * Figma `skipped` n'est pas un test raté mais une action explicite de l'utilisateur : il
 * écrase l'état précédent, `connected` compris.
 *
 * L'INVARIANT central reste entier : `status: "connected"` n'est JAMAIS persisté à partir d'un
 * verdict non vérifié. Un `connected` conservé vient d'un test réussi ANTÉRIEUR, déjà présent
 * dans le coffre ; aucun `connected` n'est fabriqué à partir de credentials non validées, et
 * les credentials refusées de la requête en cours ne sont écrites nulle part.
 */

import { testAiConnection } from "@/lib/ai-connection";
import { testFigmaConnection } from "@/lib/figma-connection";
import { testJiraConnection } from "@/lib/jira-connection";
import { createSecret } from "@/lib/secret";
import {
  emptySettingsDocument,
  type PersistedAiState,
  type PersistedFigmaState,
  type PersistedJiraState,
  type PersistedSettingsDocument,
} from "@/lib/settings-store";
import type { EncryptedStore } from "@/lib/token-storage";
import type {
  AiSettingsUpdate,
  FigmaSettingsUpdate,
  JiraSettingsUpdate,
  SaveSettingsRequest,
  SaveSettingsResponse,
} from "@/lib/types/settings";

type SettingsStore = EncryptedStore<PersistedSettingsDocument>;

/**
 * Arbitre entre l'état lu dans le coffre et celui que le verdict vient de produire, pour un
 * bloc. Appelée UNIQUEMENT depuis le `mutate` de `store.update()` : `existing` est le bloc du
 * document réellement lu à l'instant de l'écriture, pas celui d'une lecture antérieure.
 *
 * `testFailed` ne vaut `true` que pour un échec de test de connexion — jamais pour Figma
 * `skipped`, qui est une action explicite de l'utilisateur.
 */
function keepValidatedConnection<TState extends { readonly status: string }>(
  existing: TState,
  next: TState,
  testFailed: boolean,
): TState {
  return testFailed && existing.status === "connected" ? existing : next;
}

async function saveJira(
  update: JiraSettingsUpdate,
  store: SettingsStore,
): Promise<SaveSettingsResponse> {
  const verdict = await testJiraConnection(update.credentials);

  const nextJira: PersistedJiraState =
    verdict.status === "success"
      ? {
          status: "connected",
          instanceUrl: update.credentials.instanceUrl.trim(),
          email: update.credentials.email.trim(),
          apiToken: createSecret(update.credentials.apiToken),
          account: { accountName: verdict.account.accountName },
        }
      : {
          status: "not_connected",
          lastError:
            verdict.code === undefined
              ? { message: verdict.message }
              : { message: verdict.message, code: verdict.code },
        };

  const written = await store.update((current) => {
    const base = current ?? emptySettingsDocument();
    return {
      schemaVersion: base.schemaVersion,
      jira: keepValidatedConnection(base.jira, nextJira, verdict.status === "error"),
      figma: base.figma,
      ai: base.ai,
      onboardingCompleted: base.onboardingCompleted,
    };
  });

  if (written.status === "error") {
    return { block: "jira", status: "error", message: written.message };
  }
  return verdict.status === "success"
    ? { block: "jira", status: "success" }
    : { block: "jira", status: "error", message: verdict.message };
}

async function saveFigma(
  update: FigmaSettingsUpdate,
  store: SettingsStore,
): Promise<SaveSettingsResponse> {
  let nextFigma: PersistedFigmaState;
  let failureMessage: string | undefined;

  if ("skipped" in update) {
    nextFigma = { status: "skipped" };
  } else {
    const verdict = await testFigmaConnection(update.credentials);
    if (verdict.status === "success") {
      nextFigma =
        verdict.account === undefined
          ? { status: "connected", apiToken: createSecret(update.credentials.apiToken) }
          : {
              status: "connected",
              apiToken: createSecret(update.credentials.apiToken),
              account: { accountName: verdict.account.accountName },
            };
    } else {
      nextFigma = {
        status: "not_connected",
        lastError:
          verdict.code === undefined
            ? { message: verdict.message }
            : { message: verdict.message, code: verdict.code },
      };
      failureMessage = verdict.message;
    }
  }

  const written = await store.update((current) => {
    const base = current ?? emptySettingsDocument();
    return {
      schemaVersion: base.schemaVersion,
      jira: base.jira,
      // `failureMessage` n'est renseigné que par un test raté : `skipped` écrase bien.
      figma: keepValidatedConnection(base.figma, nextFigma, failureMessage !== undefined),
      ai: base.ai,
      onboardingCompleted: base.onboardingCompleted,
    };
  });

  if (written.status === "error") {
    return { block: "figma", status: "error", message: written.message };
  }
  return failureMessage === undefined
    ? { block: "figma", status: "success" }
    : { block: "figma", status: "error", message: failureMessage };
}

async function saveAi(
  update: AiSettingsUpdate,
  store: SettingsStore,
): Promise<SaveSettingsResponse> {
  const verdict = await testAiConnection(update.credentials);

  const nextAi: PersistedAiState =
    verdict.status === "success"
      ? {
          status: "connected",
          provider: update.credentials.provider,
          apiToken: createSecret(update.credentials.apiToken),
        }
      : {
          status: "not_connected",
          lastError:
            verdict.code === undefined
              ? { message: verdict.message }
              : { message: verdict.message, code: verdict.code },
        };

  const written = await store.update((current) => {
    const base = current ?? emptySettingsDocument();
    return {
      schemaVersion: base.schemaVersion,
      jira: base.jira,
      figma: base.figma,
      ai: keepValidatedConnection(base.ai, nextAi, verdict.status === "error"),
      onboardingCompleted: base.onboardingCompleted,
    };
  });

  if (written.status === "error") {
    return { block: "ai", status: "error", message: written.message };
  }
  return verdict.status === "success"
    ? { block: "ai", status: "success" }
    : { block: "ai", status: "error", message: verdict.message };
}

/**
 * Avenant d'onboarding (décision n°2 de `docs/api-contracts.md`) : marque la configuration
 * initiale comme terminée. Transition à sens unique (`false` → `true`) : la valeur est posée à
 * `true` sans relire l'état précédent, et aucun canal ne la ramène à `false`.
 *
 * Aucun appel réseau : le marqueur n'a pas de connecteur à tester. Les trois blocs sont
 * recopiés tels quels via `store.update()` — marquer l'onboarding terminé ne doit ni relire ni
 * réécrire un jeton, ni dégrader une connexion déjà établie.
 */
async function saveOnboarding(store: SettingsStore): Promise<SaveSettingsResponse> {
  const written = await store.update((current) => {
    const base = current ?? emptySettingsDocument();
    return {
      schemaVersion: base.schemaVersion,
      jira: base.jira,
      figma: base.figma,
      ai: base.ai,
      onboardingCompleted: true,
    };
  });

  if (written.status === "error") {
    return { block: "onboarding", status: "error", message: written.message };
  }
  return { block: "onboarding", status: "success" };
}

/**
 * Point d'entrée unique de `POST /api/settings`, une fois le corps de requête validé
 * (`lib/settings-request.ts`). Chaque bloc est indépendant : sauvegarder Figma ne relit ni ne
 * réécrit Jira ou l'IA autrement qu'en les recopiant tels quels via `store.update()`.
 */
export async function applySaveSettingsRequest(
  update: SaveSettingsRequest,
  store: SettingsStore,
): Promise<SaveSettingsResponse> {
  if (update.block === "onboarding") {
    return saveOnboarding(store);
  }
  if (update.block === "jira") {
    return saveJira(update, store);
  }
  if (update.block === "figma") {
    return saveFigma(update, store);
  }
  return saveAi(update, store);
}
