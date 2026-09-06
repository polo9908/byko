/**
 * BACK-10 — Historique local des analyses : schéma persisté, magasin, et capacités pures
 * de relecture (BACK-9). Même mécanisme que la configuration (ARCHI-3 via BACK-4), mais sur
 * un document DÉDIÉ : ce module ne fait QUE la forme du document sur disque et la validation
 * à la lecture — il ne connaît ni les routes HTTP, ni la récupération Jira (injectée dans
 * `lib/analysis-history-service.ts`), ni le verdict de fraîcheur (fonction pure dans
 * `lib/analysis-freshness.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DÉCISIONS DE PERSISTANCE (avenant BACK-10, `docs/api-contracts.md`, §Historique)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Fichier de coffre DÉDIÉ (`history.enc`), partageant la MÊME clé que la configuration
 *    (`master.key`, `defaultVaultLocation` d'ARCHI-3) : deux magasins sur des `configPath`
 *    différents et le même `keyPath` sont supportés par `lib/token-storage.ts`
 *    (`loadOrCreateKey` : `wx` puis relecture sur `EEXIST`). Ne pas étendre le document
 *    settings : le cycle de vie des deux documents est indépendant (un coffre de
 *    configuration corrompu ne doit pas rendre l'historique illisible, et réciproquement),
 *    et leurs schémas évoluent séparément.
 * 2. UN enregistrement par `ticketKey` : la dernière analyse RÉUSSIE seulement
 *    (`recordAnalysis` remplace l'entrée existante). L'entrée porte le résultat complet
 *    (verdict, traduction, clarification) + les métadonnées de fraîcheur (date d'analyse,
 *    date `updated` du snapshot analysé, hash de source) + le palier de comparaison.
 *    `needs` et l'étage composants (BACK-8) ne sont PAS historisés — décision documentée
 *    dans `lib/types/analysis.ts` (`AnalysisHistoryRecord`).
 * 3. Mode manuel (key = null) : JAMAIS historisé. BACK-9/BACK-10 parlent de retrouver des
 *    tickets Jira ; une saisie manuelle n'a pas de clé à rouvrir.
 * 4. Règles de non-invention héritées de BACK-4 (`lib/settings-store.ts`) : `encode`
 *    synchrone et pur (littéraux frais), `decode` strict — document racine inattendu refusé,
 *    champ absent = valeur légitime seulement si prévue, présent mais invalide = refusé, on
 *    n'invente jamais une valeur de repli. Un document altéré est refusé EN ENTIER, jamais
 *    réparé entrée par entrée : accepter une partie d'un fichier corrompu reviendrait à
 *    garantir la fraîcheur d'un résultat dont on n'a pas pu vérifier l'intégrité.
 * 5. Aucun message de `decode` ne recopie un extrait du document : le contenu des tickets
 *    (traductions, clarifications) est sensible et transite ici en clair dans le processus —
 *    seuls des messages génériques sortent, comme pour le coffre de configuration.
 */

import { join } from "node:path";

import type { ComparisonWindow, Verdict } from "@/lib/types/analysis";
import {
  createEncryptedStore,
  defaultVaultLocation,
  type DecodeResult,
  type EncryptedStore,
  type VaultLocation,
  type VaultWriteResult,
} from "@/lib/token-storage";

/** Version du document persisté — distincte de la version d'enveloppe du coffre chiffré. */
export const HISTORY_SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Schéma en mémoire                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Dernière analyse réussie d'un ticket Jira. `ticketKey` est porté PAR l'entrée (et non
 * seulement par la clé d'une table) pour que chaque enregistrement soit autoportant ; le
 * document garantit l'unicité par `ticketKey` (voir `decodeHistoryDocument`).
 *
 * `updatedAt` est la date de dernière modification Jira du contenu ANALYSÉ (le `updated` du
 * snapshot au moment de l'analyse) : c'est elle que BACK-9 compare à la date courante du
 * ticket. Elle est TOUJOURS présente dans un enregistrement — une analyse dont le snapshot
 * ne portait pas sa date de source n'est pas enregistrée (décision BACK-10 n°3,
 * `docs/api-contracts.md`) : sans elle, la fraîcheur du résultat serait indécidable et le
 * résultat serait présenté sans pouvoir être vérifié.
 */
export interface PersistedHistoryEntry {
  /** Clé Jira, normalisée par `trim` (les clés Jira ne contiennent pas d'espace). */
  readonly ticketKey: string;
  readonly verdict: Verdict;
  readonly translation: string;
  /** Message conforme au gabarit ARCHI-5, ou `null` si le verdict était `coherent`. */
  readonly clarification: string | null;
  /** ISO 8601 — moment où l'analyse a été exécutée. */
  readonly analyzedAt: string;
  /** ISO 8601 — date de dernière modification Jira du contenu analysé. */
  readonly updatedAt: string;
  /** Empreinte SHA-256 de la source du ticket (clé + `updated` + titre + corps). */
  readonly sourceHash: string;
  /** Palier de comparaison utilisé par l'analyse. */
  readonly comparisonWindow: ComparisonWindow;
}

export interface PersistedHistoryDocument {
  readonly schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  /** Dernière analyse réussie par ticket, sans doublon de `ticketKey`. */
  readonly analyses: readonly PersistedHistoryEntry[];
}

/** Premier lancement : aucune analyse enregistrée. */
export function emptyHistoryDocument(): PersistedHistoryDocument {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, analyses: [] };
}

/* -------------------------------------------------------------------------- */
/* encode — synchrone, pur, littéraux frais uniquement                         */
/* -------------------------------------------------------------------------- */

function encodeEntry(entry: PersistedHistoryEntry): Record<string, unknown> {
  return {
    ticketKey: entry.ticketKey,
    verdict: entry.verdict,
    translation: entry.translation,
    clarification: entry.clarification,
    analyzedAt: entry.analyzedAt,
    updatedAt: entry.updatedAt,
    sourceHash: entry.sourceHash,
    comparisonWindow: entry.comparisonWindow,
  };
}

export function encodeHistoryDocument(value: PersistedHistoryDocument): unknown {
  return {
    schemaVersion: value.schemaVersion,
    analyses: value.analyses.map((entry) => encodeEntry(entry)),
  };
}

/* -------------------------------------------------------------------------- */
/* decode — frontière de parsing du coffre, aucune donnée inventée             */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `Object.hasOwn` et non l'opérateur `in` : `in` remonte la chaîne de prototypes (même
 * motif que `lib/settings-store.ts`).
 */
function isKnownLiteral(
  value: unknown,
  known: Readonly<Record<string, true>>,
): boolean {
  return typeof value === "string" && Object.hasOwn(known, value);
}

/** Les 3 verdicts, miroir runtime de l'union `Verdict` — même motif que les codes d'erreur de BACK-4. */
const VERDICTS: Readonly<Record<Verdict, true>> = {
  coherent: true,
  minor_reservations: true,
  breaking_risk: true,
};

/** Les 5 paliers, miroir runtime de l'union `ComparisonWindow`. */
const COMPARISON_WINDOWS: Readonly<Record<ComparisonWindow, true>> = {
  "7d": true,
  "30d": true,
  "90d": true,
  "6m": true,
  "12m": true,
};

/**
 * Empreinte SHA-256 écrite par `lib/analysis-pipeline.ts` : 64 hexadécimaux minuscules
 * (`createHash(...).digest("hex")`). Refuser une autre forme, c'est refuser un document
 * altéré — la sourceHash ne sert à rien si elle peut être n'importe quelle chaîne.
 */
const SOURCE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Valide une entrée. `null` = format inattendu (refus du document entier par l'appelant). */
function decodeEntry(raw: unknown): PersistedHistoryEntry | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.ticketKey !== "string" ||
    raw.ticketKey === "" ||
    // La clé est normalisée par `trim` à l'écriture (`lib/analysis-runner.ts`) : une clé
    // qui se décode avec des espaces n'aurait jamais été écrite ainsi — document altéré.
    raw.ticketKey !== raw.ticketKey.trim() ||
    !isKnownLiteral(raw.verdict, VERDICTS) ||
    typeof raw.translation !== "string" ||
    raw.translation.trim() === "" ||
    !(typeof raw.clarification === "string" || raw.clarification === null) ||
    typeof raw.analyzedAt !== "string" ||
    raw.analyzedAt === "" ||
    typeof raw.updatedAt !== "string" ||
    raw.updatedAt === "" ||
    typeof raw.sourceHash !== "string" ||
    !SOURCE_HASH_PATTERN.test(raw.sourceHash) ||
    !isKnownLiteral(raw.comparisonWindow, COMPARISON_WINDOWS)
  ) {
    return null;
  }
  return {
    ticketKey: raw.ticketKey,
    verdict: raw.verdict as Verdict,
    translation: raw.translation,
    clarification: raw.clarification,
    analyzedAt: raw.analyzedAt,
    updatedAt: raw.updatedAt,
    sourceHash: raw.sourceHash,
    comparisonWindow: raw.comparisonWindow as ComparisonWindow,
  };
}

/**
 * Frontière de parsing. Le document est refusé EN ENTIER dès qu'une entrée est invalide ou
 * qu'une clé figure deux fois : l'unicité par `ticketKey` est un invariant du document (un
 * enregistrement par clé, la dernière analyse), et deux entrées pour la même clé rendraient
 * « le dernier résultat connu » indécidable — on ne tranche pas à la place de l'utilisateur.
 */
export function decodeHistoryDocument(
  document: unknown,
): DecodeResult<PersistedHistoryDocument> {
  if (!isRecord(document)) {
    return {
      ok: false,
      message:
        "Le fichier d'historique des analyses a un format inattendu (document racine non reconnu).",
    };
  }

  if (document.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    return {
      ok: false,
      message:
        "Le fichier d'historique des analyses a été écrit dans un format que cette version de l'application ne reconnaît pas.",
    };
  }

  if (!Array.isArray(document.analyses)) {
    return {
      ok: false,
      message:
        "Le fichier d'historique des analyses est illisible : la liste des analyses a un format inattendu.",
    };
  }

  const analyses: PersistedHistoryEntry[] = [];
  const seenKeys = new Set<string>();
  for (const raw of document.analyses) {
    const entry = decodeEntry(raw);
    if (entry === null || seenKeys.has(entry.ticketKey)) {
      return {
        ok: false,
        message:
          "Le fichier d'historique des analyses est illisible : une entrée a un format inattendu (ou une même clé y figure plusieurs fois).",
      };
    }
    seenKeys.add(entry.ticketKey);
    analyses.push(entry);
  }

  return {
    ok: true,
    value: { schemaVersion: HISTORY_SCHEMA_VERSION, analyses },
  };
}

/* -------------------------------------------------------------------------- */
/* Capacités pures (consommées par la relecture et le futur GET /api/tickets)  */
/* -------------------------------------------------------------------------- */

/**
 * Ajoute ou REMPLACE l'entrée d'un ticket. Fonction pure, utilisée comme `mutate` de
 * `store.update()` : la lecture du document se fait DANS la file d'écriture du magasin, au
 * moment de l'écriture (même motif que `lib/settings-service.ts` — jamais de `read` puis
 * `write` enchaînés soi-même, une écriture concurrente serait perdue).
 */
export function upsertHistoryEntry(
  document: PersistedHistoryDocument,
  entry: PersistedHistoryEntry,
): PersistedHistoryDocument {
  return {
    schemaVersion: document.schemaVersion,
    analyses: [
      ...document.analyses.filter((item) => item.ticketKey !== entry.ticketKey),
      entry,
    ],
  };
}

/**
 * Enregistre la dernière analyse réussie d'un ticket : `update` sérialisé du magasin, qui
 * crée le coffre au premier enregistrement (`current` est `undefined` → document vide) et
 * refuse d'écraser un coffre qu'il n'a pas su lire (une lecture en erreur interrompt la mise
 * à jour, dans `lib/token-storage.ts`).
 */
export function recordAnalysis(
  store: EncryptedStore<PersistedHistoryDocument>,
  entry: PersistedHistoryEntry,
): Promise<VaultWriteResult> {
  return store.update((current) =>
    upsertHistoryEntry(current ?? emptyHistoryDocument(), entry),
  );
}

/**
 * Parmi des `ticketKeys`, lesquelles ont déjà été analysées (présence d'une entrée) ?
 * Capacité pure que `GET /api/tickets` (câblage FRONT-7) utilisera pour injecter
 * `alreadyAnalyzed: boolean` par ticket — cf. `docs/api-contracts.md`, §Historique des
 * analyses. L'ordre de sortie suit l'ordre d'entrée : l'analyse n'influence jamais l'ordre
 * de la liste de gauche (règle produit).
 */
export function selectAlreadyAnalyzed(
  analyses: readonly PersistedHistoryEntry[],
  ticketKeys: readonly string[],
): readonly string[] {
  const analyzedKeys = new Set(analyses.map((entry) => entry.ticketKey));
  return ticketKeys.filter((key) => analyzedKeys.has(key));
}

/* -------------------------------------------------------------------------- */
/* Magasin                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Emplacement du coffre d'historique : `history.enc` dans le même dossier que la
 * configuration (`~/.bcc` par défaut), avec la MÊME clé `master.key`. Deux magasins sur des
 * `configPath` différents partageant le même `keyPath` sont supportés par ARCHI-3 (voir
 * l'en-tête). `defaultVaultLocation` résout `homedir()` à l'appel — jamais au chargement du
 * module, pour qu'un import ne dépende pas de l'environnement et que les tests puissent
 * pointer `HOME` ailleurs.
 */
export function defaultHistoryVaultLocation(baseDirectory?: string): VaultLocation {
  const base = defaultVaultLocation(baseDirectory);
  return { ...base, configPath: join(base.directory, "history.enc") };
}

/**
 * Magasin NEUF sur un emplacement explicite : chaque appel rend une instance distincte,
 * donc sa propre file d'écriture. Réservé aux tests (répertoire temporaire) — la couche
 * HTTP passe par `getAnalysisHistoryStore()`.
 */
export function createAnalysisHistoryStore(
  location: VaultLocation,
): EncryptedStore<PersistedHistoryDocument> {
  return createEncryptedStore<PersistedHistoryDocument>({
    decode: decodeHistoryDocument,
    encode: encodeHistoryDocument,
    location,
  });
}

/**
 * Magasins partagés, indexés par emplacement de coffre — même mécanisme et même motif que
 * `getSettingsStore` (audit du 05/09/2026, constat bloquant) : une instance par requête
 * donnerait une file d'écriture par requête, et deux analyses réussies en vol simultanément
 * (deux tickets analysés en parallèle depuis l'espace de travail) liraient le même document
 * puis se le réécriraient l'une sur l'autre — la perdante répondrait quand même `success`.
 */
const sharedHistoryStores = new Map<string, EncryptedStore<PersistedHistoryDocument>>();

/**
 * Deux emplacements ne sont le même que si LEURS DEUX fichiers le sont — coffre et clé.
 * Même forme de clé de table que `lib/settings-store.ts`.
 */
function vaultKey(location: VaultLocation): string {
  return JSON.stringify([location.configPath, location.keyPath]);
}

/**
 * Le magasin du coffre d'historique par défaut (`$HOME/.bcc/history.enc`) : le seul point
 * d'accès de la couche HTTP. Deux requêtes concurrentes du même processus obtiennent la
 * même instance, donc la même file d'écriture.
 */
export function getAnalysisHistoryStore(): EncryptedStore<PersistedHistoryDocument> {
  const location = defaultHistoryVaultLocation();
  const key = vaultKey(location);

  const shared = sharedHistoryStores.get(key);
  if (shared !== undefined) {
    return shared;
  }

  const store = createAnalysisHistoryStore(location);
  sharedHistoryStores.set(key, store);
  return store;
}
