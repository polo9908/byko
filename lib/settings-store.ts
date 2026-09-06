/**
 * BACK-4 — Schéma persisté de la configuration (Jira, Figma, IA), et son couple
 * `encode`/`decode` pour `createEncryptedStore` (`lib/token-storage.ts`, ARCHI-3).
 *
 * Ce module ne fait QUE la forme du document sur disque et sa validation à la lecture. Il ne
 * connaît ni les routes HTTP (`app/api/settings/route.ts`), ni les connecteurs de test
 * (`lib/*-connection.ts`), ni la forme exposée par `GET /api/settings`
 * (`SettingsState`, `lib/types/settings.ts`, `lib/settings-mapper.ts`).
 *
 * INVARIANT à respecter ici (charge documentée par `lib/token-storage.ts`, §« Ce qui n'est
 * pas garanti ») : `encode()` doit être synchrone, pure, et ne produire que des données JSON
 * ordinaires (aucun accesseur, aucun `Proxy`, aucun `toJSON` personnalisé porté par le
 * document renvoyé) — c'est ce que font les fonctions `encode…` ci-dessous, qui construisent
 * des littéraux frais. `revealSecret()` n'apparaît QUE dans ces fonctions `encode…`, jamais
 * ailleurs dans ce fichier ni dans les modules qui l'appellent.
 *
 * Extensibilité : le document porte un `schemaVersion` explicite. L'avenant d'onboarding
 * (`onboardingCompleted`, décision n°2 de `docs/api-contracts.md`) est le PREMIER à s'appuyer
 * dessus, sans changer de version : un coffre écrit avant l'avenant (donc sans le champ) reste
 * lisible — `onboardingCompleted` est absent du disque, `decode()` le pose à `false`, car une
 * configuration jamais marquée « terminée » est une configuration dont l'onboarding n'a pas
 * été confirmé. Un champ présent mais non booléen, lui, est un coffre altéré : refusé comme le
 * reste du document.
 */

import { createSecret, revealSecret, type Secret } from "@/lib/secret";
import {
  createEncryptedStore,
  defaultVaultLocation,
  type DecodeResult,
  type EncryptedStore,
  type VaultLocation,
} from "@/lib/token-storage";
import type {
  AiTestConnectionErrorCode,
  FigmaTestConnectionErrorCode,
  JiraTestConnectionErrorCode,
  PersistedConnectionError,
  ProviderId,
} from "@/lib/types/settings";

/** Version du document persisté — distincte de la version d'enveloppe du coffre chiffré. */
export const SETTINGS_SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Schéma en mémoire — le jeton y vit sous forme de `Secret`, jamais de `string` nue */
/* -------------------------------------------------------------------------- */

export type PersistedJiraState =
  | {
      readonly status: "connected";
      readonly instanceUrl: string;
      readonly email: string;
      readonly apiToken: Secret;
      readonly account: { readonly accountName: string };
    }
  | {
      readonly status: "not_connected";
      readonly lastError?: PersistedConnectionError<JiraTestConnectionErrorCode>;
    };

export type PersistedFigmaState =
  | {
      readonly status: "connected";
      readonly apiToken: Secret;
      readonly account?: { readonly accountName: string };
    }
  | {
      readonly status: "not_connected";
      readonly lastError?: PersistedConnectionError<FigmaTestConnectionErrorCode>;
    }
  | { readonly status: "skipped" };

export type PersistedAiState =
  | {
      readonly status: "connected";
      readonly provider: ProviderId;
      readonly apiToken: Secret;
    }
  | {
      readonly status: "not_connected";
      readonly lastError?: PersistedConnectionError<AiTestConnectionErrorCode>;
    };

export interface PersistedSettingsDocument {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly jira: PersistedJiraState;
  readonly figma: PersistedFigmaState;
  readonly ai: PersistedAiState;
  readonly onboardingCompleted: boolean;
}

/** Premier lancement : les trois blocs `not_connected`, onboarding non terminé. */
export function emptySettingsDocument(): PersistedSettingsDocument {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    jira: { status: "not_connected" },
    figma: { status: "not_connected" },
    ai: { status: "not_connected" },
    onboardingCompleted: false,
  };
}

/* -------------------------------------------------------------------------- */
/* encode — synchrone, pur, littéraux frais uniquement                        */
/* -------------------------------------------------------------------------- */

function encodeError<TCode extends string>(
  error: PersistedConnectionError<TCode>,
): { message: string; code?: TCode } {
  return error.code === undefined
    ? { message: error.message }
    : { message: error.message, code: error.code };
}

function encodeJira(state: PersistedJiraState): unknown {
  if (state.status === "connected") {
    return {
      status: "connected",
      instanceUrl: state.instanceUrl,
      email: state.email,
      apiToken: revealSecret(state.apiToken),
      account: { accountName: state.account.accountName },
    };
  }
  return state.lastError === undefined
    ? { status: "not_connected" }
    : { status: "not_connected", lastError: encodeError(state.lastError) };
}

function encodeFigma(state: PersistedFigmaState): unknown {
  if (state.status === "connected") {
    return state.account === undefined
      ? { status: "connected", apiToken: revealSecret(state.apiToken) }
      : {
          status: "connected",
          apiToken: revealSecret(state.apiToken),
          account: { accountName: state.account.accountName },
        };
  }
  if (state.status === "skipped") {
    return { status: "skipped" };
  }
  return state.lastError === undefined
    ? { status: "not_connected" }
    : { status: "not_connected", lastError: encodeError(state.lastError) };
}

function encodeAi(state: PersistedAiState): unknown {
  if (state.status === "connected") {
    return {
      status: "connected",
      provider: state.provider,
      apiToken: revealSecret(state.apiToken),
    };
  }
  return state.lastError === undefined
    ? { status: "not_connected" }
    : { status: "not_connected", lastError: encodeError(state.lastError) };
}

export function encodeSettingsDocument(value: PersistedSettingsDocument): unknown {
  return {
    schemaVersion: value.schemaVersion,
    jira: encodeJira(value.jira),
    figma: encodeFigma(value.figma),
    ai: encodeAi(value.ai),
    onboardingCompleted: value.onboardingCompleted,
  };
}

/* -------------------------------------------------------------------------- */
/* decode — frontière de parsing du coffre, aucune donnée inventée             */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type OptionalErrorResult<TCode extends string> =
  | { readonly ok: true; readonly value?: PersistedConnectionError<TCode> }
  | { readonly ok: false };

/**
 * Codes d'erreur admis à la lecture, un jeu par bloc.
 *
 * `satisfies Record<…, true>` rend chaque liste EXHAUSTIVE dans les deux sens, à la
 * compilation : un code ajouté à l'union de `lib/types/settings.ts` sans l'être ici ne
 * compile pas (propriété manquante), et une clé qui n'appartient pas à l'union non plus
 * (propriété excédentaire sur un littéral). `as const` conserve les clés littérales, dont
 * `KnownCodes` déduit ensuite le paramètre de type.
 */
const JIRA_ERROR_CODES = {
  invalid_url: true,
  invalid_token: true,
  instance_unreachable: true,
  timeout: true,
} as const satisfies Record<JiraTestConnectionErrorCode, true>;

const FIGMA_ERROR_CODES = {
  invalid_token: true,
  rate_limited: true,
} as const satisfies Record<FigmaTestConnectionErrorCode, true>;

const AI_ERROR_CODES = {
  invalid_token: true,
  quota_exceeded: true,
  provider_unavailable: true,
} as const satisfies Record<AiTestConnectionErrorCode, true>;

type KnownCodes<TCode extends string> = Readonly<Record<TCode, true>>;

/**
 * `Object.hasOwn` et non l'opérateur `in` : `in` remonte la chaîne de prototypes, et
 * `"toString" in codes` répondrait `true` — un coffre altéré ferait alors passer `toString`
 * pour un code valide.
 */
function isKnownCode<TCode extends string>(
  value: unknown,
  known: KnownCodes<TCode>,
): value is TCode {
  return typeof value === "string" && Object.hasOwn(known, value);
}

/**
 * `lastError` absent est une valeur légitime (« aucun échec connu »), pas un défaut.
 *
 * `code`, lui, est refusé s'il n'appartient pas à l'union du bloc : le coffre vient du
 * disque, où il a pu être modifié hors de l'application, et un code hors contrat ressortirait
 * tel quel sur `GET /api/settings`. Le document entier est alors déclaré illisible
 * (`{ ok: false }`) plutôt que réparé en silence — on n'invente pas le code manquant.
 */
function readOptionalError<TCode extends string>(
  value: unknown,
  knownCodes: KnownCodes<TCode>,
): OptionalErrorResult<TCode> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!isRecord(value) || typeof value.message !== "string") {
    return { ok: false };
  }
  if (value.code === undefined) {
    return { ok: true, value: { message: value.message } };
  }
  if (!isKnownCode(value.code, knownCodes)) {
    return { ok: false };
  }
  return { ok: true, value: { message: value.message, code: value.code } };
}

function decodeJira(raw: unknown): PersistedJiraState | null {
  if (!isRecord(raw)) return null;

  if (raw.status === "connected") {
    if (
      typeof raw.instanceUrl !== "string" ||
      typeof raw.email !== "string" ||
      typeof raw.apiToken !== "string" ||
      !isRecord(raw.account) ||
      typeof raw.account.accountName !== "string"
    ) {
      return null;
    }
    return {
      status: "connected",
      instanceUrl: raw.instanceUrl,
      email: raw.email,
      apiToken: createSecret(raw.apiToken),
      account: { accountName: raw.account.accountName },
    };
  }

  if (raw.status === "not_connected") {
    const error = readOptionalError<JiraTestConnectionErrorCode>(raw.lastError, JIRA_ERROR_CODES);
    if (!error.ok) return null;
    return error.value === undefined
      ? { status: "not_connected" }
      : { status: "not_connected", lastError: error.value };
  }

  return null;
}

function decodeFigma(raw: unknown): PersistedFigmaState | null {
  if (!isRecord(raw)) return null;

  if (raw.status === "connected") {
    if (typeof raw.apiToken !== "string") return null;
    if (raw.account === undefined) {
      return { status: "connected", apiToken: createSecret(raw.apiToken) };
    }
    if (!isRecord(raw.account) || typeof raw.account.accountName !== "string") {
      return null;
    }
    return {
      status: "connected",
      apiToken: createSecret(raw.apiToken),
      account: { accountName: raw.account.accountName },
    };
  }

  if (raw.status === "skipped") {
    return { status: "skipped" };
  }

  if (raw.status === "not_connected") {
    const error = readOptionalError<FigmaTestConnectionErrorCode>(
      raw.lastError,
      FIGMA_ERROR_CODES,
    );
    if (!error.ok) return null;
    return error.value === undefined
      ? { status: "not_connected" }
      : { status: "not_connected", lastError: error.value };
  }

  return null;
}

const PROVIDER_IDS: readonly ProviderId[] = [
  "anthropic",
  "openai",
  "deepseek",
  "kimi",
  "grok",
  "gemini",
];

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

function decodeAi(raw: unknown): PersistedAiState | null {
  if (!isRecord(raw)) return null;

  if (raw.status === "connected") {
    if (!isProviderId(raw.provider) || typeof raw.apiToken !== "string") {
      return null;
    }
    return {
      status: "connected",
      provider: raw.provider,
      apiToken: createSecret(raw.apiToken),
    };
  }

  if (raw.status === "not_connected") {
    const error = readOptionalError<AiTestConnectionErrorCode>(raw.lastError, AI_ERROR_CODES);
    if (!error.ok) return null;
    return error.value === undefined
      ? { status: "not_connected" }
      : { status: "not_connected", lastError: error.value };
  }

  return null;
}

/**
 * `onboardingCompleted` absent est une valeur légitime, pas un défaut : c'est un coffre écrit
 * AVANT l'avenant d'onboarding (même `schemaVersion`), donc une configuration dont l'onboarding
 * n'a jamais été confirmé. Il se lit `false`, jamais inventé à `true`.
 *
 * Présent mais non booléen, en revanche, c'est un coffre altéré : `null` est refusé, comme
 * tout le reste du document — on n'invente pas une valeur de repli.
 */
function readOnboardingCompleted(value: unknown): boolean | null {
  if (value === undefined) {
    return false;
  }
  return typeof value === "boolean" ? value : null;
}

export function decodeSettingsDocument(document: unknown): DecodeResult<PersistedSettingsDocument> {
  if (!isRecord(document)) {
    return {
      ok: false,
      message: "Le coffre de configuration a un format inattendu (document racine non reconnu).",
    };
  }

  if (document.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    return {
      ok: false,
      message:
        "Le coffre de configuration a été écrit dans un format que cette version de l'application ne reconnaît pas.",
    };
  }

  const jira = decodeJira(document.jira);
  const figma = decodeFigma(document.figma);
  const ai = decodeAi(document.ai);
  if (jira === null || figma === null || ai === null) {
    return {
      ok: false,
      message:
        "Le coffre de configuration est illisible : un des blocs (Jira, Figma, Modèle IA) a un format inattendu.",
    };
  }

  const onboardingCompleted = readOnboardingCompleted(document.onboardingCompleted);
  if (onboardingCompleted === null) {
    return {
      ok: false,
      message:
        "Le coffre de configuration est illisible : le marqueur d'onboarding a un format inattendu.",
    };
  }

  return {
    ok: true,
    value: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      jira,
      figma,
      ai,
      onboardingCompleted,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Magasin                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Magasin NEUF sur un emplacement explicite : chaque appel rend une instance distincte, donc
 * sa propre file d'écriture.
 *
 * `location` est obligatoire, et c'est délibéré depuis le correctif ci-dessous : une instance
 * neuve sur le coffre par défaut de l'utilisateur est exactement ce qu'il ne faut pas
 * fabriquer depuis la couche HTTP (voir `getSettingsStore`). Rendre l'emplacement obligatoire
 * fait porter cette erreur par le compilateur plutôt que par la relecture. Les appelants
 * légitimes sont les tests, qui visent un répertoire temporaire et veulent parfois DEUX
 * instances sur le même coffre (simuler une fermeture/rouverture de l'application).
 */
export function createSettingsStore(
  location: VaultLocation,
): EncryptedStore<PersistedSettingsDocument> {
  return createEncryptedStore<PersistedSettingsDocument>({
    decode: decodeSettingsDocument,
    encode: encodeSettingsDocument,
    location,
  });
}

/**
 * Magasins partagés, indexés par emplacement de coffre.
 *
 * POURQUOI (audit du 05/09/2026, constat bloquant) : `createEncryptedStore` sérialise les
 * cycles lecture-modification-écriture dans une file d'attente LOCALE À L'INSTANCE
 * (`lib/token-storage.ts`). Un magasin construit par requête donne donc une file par requête,
 * et deux sauvegardes en vol simultanément — le cas nominal de `POST /api/settings`, chaque
 * bloc étant sauvegardé dès sa validation — lisent le même document puis se le réécrivent
 * l'une sur l'autre : la perdante répond quand même `success`. La garantie annoncée par
 * `update()` est réelle, mais elle ne s'obtient qu'en partageant l'instance.
 *
 * GRANULARITÉ : une instance par emplacement de coffre, et non un singleton de module. C'est
 * la granularité de la ressource réellement sérialisée — un fichier de coffre — et non celle
 * du module qui y accède. Conséquence directe et voulue : `defaultVaultLocation()` est résolu
 * À CHAQUE APPEL (il lit `homedir()` à l'appel, jamais au chargement du module), donc deux
 * `HOME` différents donnent deux emplacements, donc deux magasins indépendants. Aucun point
 * d'injection ni fonction de remise à zéro n'est nécessaire pour cela.
 *
 * CE QUE ÇA COUVRE : toutes les requêtes servies par une même instance chargée de ce module,
 * quel que soit leur entrelacement.
 *
 * CE QUE ÇA NE COUVRE PAS : deux processus écrivant le même coffre — il n'y a pas de verrou de
 * fichier, `lib/token-storage.ts` le documente déjà comme non garanti. De même, si le runtime
 * recharge ce module (rechargement à chaud en développement), la table naît à nouveau : le
 * partage vaut par instance de module chargée, ce que ce fichier ne peut pas garantir au-delà.
 *
 * TABLE QUI GRANDIT : une entrée par emplacement de coffre visité par le processus. Les clés
 * ne viennent JAMAIS d'une donnée de requête, seulement de `defaultVaultLocation()` : en
 * production il n'y a qu'un emplacement (`$HOME/.bcc`), donc au plus une entrée, et rien qui
 * croisse avec le trafic. Sous test, une entrée par `HOME` temporaire, dans un processus qui
 * s'arrête avec le fichier de test. Il n'y a donc rien à purger.
 */
const sharedSettingsStores = new Map<string, EncryptedStore<PersistedSettingsDocument>>();

/**
 * Deux emplacements ne sont le même que si LEURS DEUX fichiers le sont — coffre et clé. La
 * clé de table passe par `JSON.stringify` d'un couple plutôt que par une concaténation : un
 * chemin peut contenir n'importe quel caractère de séparation qu'on choisirait, alors que
 * l'échappement de JSON garde l'application injective.
 */
function vaultKey(location: VaultLocation): string {
  return JSON.stringify([location.configPath, location.keyPath]);
}

/**
 * Le magasin du coffre par défaut (`$HOME/.bcc`) : **le seul point d'accès de la couche HTTP**.
 * Deux requêtes concurrentes du même processus obtiennent la même instance, donc la même file
 * d'écriture, donc aucune des deux ne peut écraser l'autre.
 */
export function getSettingsStore(): EncryptedStore<PersistedSettingsDocument> {
  const location = defaultVaultLocation();
  const key = vaultKey(location);

  const shared = sharedSettingsStores.get(key);
  if (shared !== undefined) {
    return shared;
  }

  const store = createSettingsStore(location);
  sharedSettingsStores.set(key, store);
  return store;
}
