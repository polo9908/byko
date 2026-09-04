/**
 * ARCHI-3 — Stockage local chiffré (`docs/tickets/phase-1-configuration.md`, lignes 82-100).
 *
 * Ce module pose le MÉCANISME de persistance chiffrée. Il ne connaît pas le schéma de la
 * configuration : celui-ci appartient à BACK-4, qui le fournit sous la forme d'un couple
 * `encode` / `decode`. Écrire ici la forme des blocs Jira / Figma / IA reviendrait à
 * inventer le contenu d'un ticket qui n'est pas écrit — et à figer, dans le module le plus
 * sensible du projet, un schéma que son propriétaire n'a pas encore arbitré.
 *
 * Justification des choix cryptographiques, du modèle de menace et de ses limites :
 * `docs/architecture/token-storage.md`. Ce qui suit n'en est que le rappel opérationnel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI EST GARANTI
 * ─────────────────────────────────────────────────────────────────────────────
 * - Le contenu écrit dans `~/.bcc/config.enc` est chiffré en AES-256-GCM. Une lecture
 *   directe du fichier ne rend que l'enveloppe (format, version, IV, tag, base64) —
 *   critère d'acceptation ligne 94.
 * - La clé vit dans un fichier distinct (`~/.bcc/master.key`), jamais dans le fichier de
 *   configuration ni dans le dépôt.
 * - Toute écriture est atomique (fichier temporaire + `rename`) : une coupure ne laisse
 *   jamais un `config.enc` à moitié écrit, donc jamais un coffre indéchiffrable.
 * - Aucune fonction de ce module ne journalise quoi que ce soit, et **aucun message
 *   d'erreur produit ici ne recopie l'exception d'origine**. Ce n'est pas une précaution
 *   de principe : V8 recopie un extrait de son entrée dans les messages de `JSON.parse`
 *   (vérifié le 04/09/2026 — `JSON.parse('{"apiToken": <jeton>}')` lève
 *   « Unexpected token 'j', ...\"piToken\": jeton-sent\"... is not valid JSON »), et cette
 *   entrée est ici le clair déchiffré. Les messages sont donc rédigés en entier dans ce
 *   fichier ; des erreurs système, seul le code errno (`EACCES`, `ENOSPC`…) est repris,
 *   jamais leur texte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS GARANTI — à lire avant BACK-4
 * ─────────────────────────────────────────────────────────────────────────────
 * - **La clé est en clair à côté du coffre.** Sans compte ni mot de passe utilisateur en
 *   v1, il n'existe aucun secret dont la dériver. Un attaquant qui lit `~/.bcc` lit les
 *   deux fichiers et déchiffre. Ce que le chiffrement protège vraiment — et ce qu'il ne
 *   protège pas : §« Modèle de menace » de `docs/architecture/token-storage.md`.
 * - **Un coffre absent et un coffre illisible sont deux résultats distincts** (`absent` vs
 *   `error`) et ne doivent jamais être confondus : `docs/api-contracts.md` (§`GET
 *   /api/settings`) en fait une obligation — rabattre une panne de lecture sur « aucune
 *   configuration » resservirait l'onboarding à un utilisateur déjà configuré, et la
 *   première écriture écraserait alors une configuration qu'on n'a pas su lire.
 * - **La sérialisation de BACK-4 doit déballer les `Secret` explicitement**
 *   (`revealSecret`, `lib/secret.ts`). `encode()` qui laisserait passer un `Secret` écrirait
 *   son masque à la place du jeton ; l'écriture est donc REFUSÉE dans ce cas
 *   (`invalid_payload`), plutôt que de produire un coffre valide contenant un faux jeton.
 * - **`decode()` est du code appelant** : le `message` qu'il renvoie ressort tel quel par
 *   `GET /api/settings`. Même charge de rédaction que pour BACK-1/2/3 (§Risque résiduel de
 *   `docs/api-contracts.md`) : jamais de jeton, jamais de contenu déchiffré brut.
 * - **La sérialisation des écritures est locale au processus.** Deux processus Node
 *   (p. ex. `next dev` et `next start` en même temps) ne se voient pas : il n'y a pas de
 *   verrou de fichier.
 *
 * Ce module lit et écrit le disque : il est réservé au serveur (`app/api/`). Le paquet
 * `server-only` n'est pas installé (aucune dépendance ajoutée, contrainte ARCHI-1) ; ce
 * sont ses imports `node:` qui font échouer un bundle client.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { isSecret } from "@/lib/secret";

/* -------------------------------------------------------------------------- */
/* Constantes de format                                                       */
/* -------------------------------------------------------------------------- */

/** Marqueur de format, vérifié à la lecture : un fichier étranger est rejeté, pas déchiffré. */
const VAULT_FORMAT = "bcc-vault";

/**
 * Version d'enveloppe. C'est le point d'extension prévu pour la v2 (clé par compte) :
 * un lecteur qui rencontre une version inconnue le DIT (`unsupported_version`) au lieu de
 * l'interpréter de travers. Vérifié aujourd'hui, pas seulement annoncé.
 */
const VAULT_VERSION = 1;

/** AES-256 en mode GCM : chiffrement + authentification en une passe (cf. doc d'architecture). */
const ALGORITHM = "aes-256-gcm";

const KEY_BYTES = 32;

/** 96 bits : taille de nonce nominale de GCM, la seule qui n'impose pas de dérivation interne. */
const IV_BYTES = 12;

/** Tag d'authentification GCM, longueur maximale (128 bits). */
const TAG_BYTES = 16;

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Délai maximal laissé à la fonction `mutate` d'`update()`. La file d'attente sérialise
 * les écritures (voir `enqueue`) : si `mutate` ne se règle jamais (une promesse oubliée,
 * un appel réseau qui ne répond pas), rien ne le signale et la file reste bloquée pour
 * toujours, y compris pour tout appelant futur qui n'a rien à voir avec cet appel-là —
 * vérifié le 04/09/2026 (`update(() => new Promise(() => {}))` gèle silencieusement toute
 * écriture ultérieure du processus). Le délai n'a pas besoin d'être court : BACK-4 exécute
 * une simple transformation en mémoire, jamais un appel réseau à l'intérieur de `mutate`.
 */
const UPDATE_MUTATE_TIMEOUT_MS = 30_000;

/**
 * Données associées (AAD) : authentifiées par GCM sans être chiffrées. Elles lient le
 * chiffré à son format et à sa version — un fichier de version 2 ne pourra pas être
 * représenté comme un fichier de version 1 en réécrivant simplement son en-tête, le
 * déchiffrement échouerait.
 */
const ADDITIONAL_DATA = Buffer.from(
  `${VAULT_FORMAT}:${VAULT_VERSION}:${ALGORITHM}`,
  "utf8",
);

/* -------------------------------------------------------------------------- */
/* Emplacement                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Les trois chemins du coffre. Séparés en un type à part parce que c'est le point
 * d'injection des tests (répertoire temporaire) et, en v2, celui de la clé par compte
 * (`master.key` → `accounts/<id>.key`).
 */
export interface VaultLocation {
  readonly directory: string;
  /** Coffre chiffré. */
  readonly configPath: string;
  /** Clé de chiffrement, fichier distinct du coffre (ticket, ligne 90). */
  readonly keyPath: string;
}

/**
 * `~/.bcc` par défaut (`ou équivalent`, ticket ligne 90) : hors du dépôt, donc jamais
 * commité par accident, et hors du répertoire de travail, donc conservé entre deux
 * réinstallations.
 *
 * `homedir()` n'est appelé qu'ici, à l'appel — jamais au chargement du module, pour qu'un
 * import ne dépende pas de l'environnement.
 */
export function defaultVaultLocation(
  baseDirectory: string = join(homedir(), ".bcc"),
): VaultLocation {
  return {
    directory: baseDirectory,
    configPath: join(baseDirectory, "config.enc"),
    keyPath: join(baseDirectory, "master.key"),
  };
}

/* -------------------------------------------------------------------------- */
/* Résultats                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Causes d'échec, distinctes parce que la conduite à tenir diffère pour chacune. Le
 * vocabulaire est repris de celui d'ARCHI-2 (`status` / `message` / `code` optionnel) pour
 * que BACK-4 n'ait pas deux grammaires d'erreur à traduire.
 *
 * - `permission_denied` : droits insuffisants sur `~/.bcc`.
 * - `key_missing` : le coffre existe, sa clé a disparu. **Irréversible** — c'est le seul cas
 *   où des données sont définitivement perdues, et surtout le cas où il ne faut SURTOUT pas
 *   générer une nouvelle clé (voir `read`).
 * - `key_invalid` : le fichier de clé existe mais ne contient pas 32 octets en base64.
 * - `corrupted` : l'enveloppe n'est pas lisible (fichier vide, tronqué, JSON invalide,
 *   champ manquant, base64 non canonique).
 * - `unsupported_version` : enveloppe écrite par une version plus récente de l'application.
 * - `decryption_failed` : le tag GCM ne valide pas. Fichier modifié après écriture, ou
 *   chiffré avec une autre clé — GCM authentifie, il ne dit pas laquelle des deux.
 * - `invalid_content` : déchiffrement réussi, contenu inattendu (JSON invalide, ou `decode`
 *   de l'appelant qui refuse).
 * - `invalid_payload` : la valeur à écrire n'est pas sérialisable, ou contient un `Secret`
 *   non déballé.
 * - `io_error` : toute autre erreur système ; `code` porte alors l'errno.
 */
export type VaultErrorKind =
  | "permission_denied"
  | "key_missing"
  | "key_invalid"
  | "corrupted"
  | "unsupported_version"
  | "decryption_failed"
  | "invalid_content"
  | "invalid_payload"
  | "io_error";

/**
 * `message` est en français et destiné à être affiché tel quel (variante d'erreur de
 * `GetSettingsResponse`, `docs/api-contracts.md`) : il dit ce que l'utilisateur peut faire.
 * `code` est l'errno système quand il y en a un — signal machine, jamais affiché seul.
 */
export interface VaultErrorResult {
  readonly status: "error";
  readonly kind: VaultErrorKind;
  readonly message: string;
  readonly code?: string;
}

export interface VaultOkResult<T> {
  readonly status: "ok";
  readonly value: T;
}

export type VaultOutcome<T> = VaultOkResult<T> | VaultErrorResult;

/**
 * Trois issues, et **pas** un booléen : `absent` (premier lancement, aucun coffre) doit
 * rester impossible à confondre avec `error` (coffre présent mais illisible). Avec un
 * `ok: boolean`, le raccourci `if (!result.ok) return "aucune configuration"` compile et
 * écrase des données à la première écriture ; avec trois variantes, l'oubli d'un cas se
 * voit à la lecture.
 *
 * Aucune fonction de commodité (`readOrNull`, `readOrDefault`) n'est exposée : elle
 * recréerait exactement cette confusion.
 */
export type VaultReadResult<T> =
  | { readonly status: "loaded"; readonly value: T }
  | { readonly status: "absent" }
  | VaultErrorResult;

export type VaultWriteResult =
  | { readonly status: "written" }
  | VaultErrorResult;

/** Retour de `decode` : `message` est affiché tel quel, il ne doit contenir aucun jeton. */
export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/* -------------------------------------------------------------------------- */
/* Fabriques d'erreurs                                                        */
/* -------------------------------------------------------------------------- */

function vaultError(
  kind: VaultErrorKind,
  message: string,
  code?: string,
): VaultErrorResult {
  return code === undefined
    ? { status: "error", kind, message }
    : { status: "error", kind, message, code };
}

/** Errno d'une erreur système, sans jamais reprendre son texte (cf. en-tête). */
function errnoOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const candidate: unknown = (error as { code?: unknown }).code;
    return typeof candidate === "string" ? candidate : undefined;
  }
  return undefined;
}

function isPermissionErrno(code: string | undefined): boolean {
  return code === "EACCES" || code === "EPERM";
}

/** Erreur système → résultat typé, avec un message qui nomme le chemin en cause. */
function fromSystemError(
  error: unknown,
  action: string,
  path: string,
): VaultErrorResult {
  const code = errnoOf(error);
  if (isPermissionErrno(code)) {
    return vaultError(
      "permission_denied",
      `Droits insuffisants pour ${action} ${path}. Vérifie que ce fichier t'appartient (il doit être en 0600, son dossier en 0700).`,
      code,
    );
  }
  return vaultError(
    "io_error",
    `Impossible de ${action} ${path}${code === undefined ? "" : ` (${code})`}.`,
    code,
  );
}

/* -------------------------------------------------------------------------- */
/* Base64 strict                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `Buffer.from(texte, "base64")` est PERMISSIF : il ignore silencieusement les caractères
 * invalides et s'arrête au premier remplissage venu — `Buffer.from("!!!!", "base64")` rend
 * un tampon vide sans lever. Un fichier de clé corrompu passerait donc pour une clé courte,
 * et une enveloppe abîmée pour une enveloppe valide.
 *
 * Le ré-encodage canonique referme ce trou : on n'accepte le décodage que s'il reproduit
 * exactement le texte lu. Comportement permissif vérifié le 04/09/2026 par sonde jetable
 * hors dépôt (`docs/architecture/token-storage.md`, §Vérifications).
 */
function decodeBase64(text: string, expectedBytes?: number): Buffer | null {
  const decoded = Buffer.from(text, "base64");
  if (decoded.toString("base64") !== text) {
    return null;
  }
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    return null;
  }
  return decoded;
}

/* -------------------------------------------------------------------------- */
/* Enveloppe                                                                  */
/* -------------------------------------------------------------------------- */

interface VaultEnvelope {
  readonly format: string;
  readonly v: number;
  readonly alg: string;
  readonly iv: string;
  readonly tag: string;
  readonly ct: string;
}

function readStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

/**
 * `EncryptedStoreOptions.encode` est typé `(value: T) => unknown`, une signature
 * synchrone — mais `unknown` accepte aussi une `Promise<unknown>` : rien à la compilation
 * n'empêche de passer une fonction `async`. Sans ce garde-fou, une telle fonction ferait
 * persister l'objet `Promise` lui-même (`JSON.stringify` d'une Promise rend `"{}"`) : un
 * coffre valide, silencieusement vide — vérifié le 04/09/2026.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Règle une promesse à un délai maximal. Rejette avec un message générique, jamais avec la
 * valeur ou l'erreur d'origine de `task` : celle-ci peut porter un jeton (cas de `mutate`
 * dans `update()`).
 */
function withTimeout<R>(task: Promise<R>, timeoutMs: number, what: string): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Délai dépassé (${what}).`));
    }, timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Chiffrement — niveau bas, exposé pour la vérification et pour la v2         */
/* -------------------------------------------------------------------------- */

/**
 * Résout `value` exactement comme `SerializeJSONProperty` (l'algorithme interne de
 * `JSON.stringify`, ECMA-262 §25.5.2.1) résout la valeur d'UNE propriété : si elle porte
 * un `toJSON` appelable, il est invoqué UNE SEULE FOIS, avec la clé de la propriété d'où
 * elle vient (chaîne vide à la racine, index en chaîne dans un tableau). Le résultat n'est
 * PAS re-résolu ici, exactement comme `JSON.stringify` ne rappelle jamais `toJSON` sur son
 * propre retour à ce même niveau — il ne le fera que si CE retour est lui-même relu comme
 * la valeur d'une propriété plus bas, ce que la récursion normale fait déjà.
 *
 * Une première version de cette garde (revue croisée du 04/09/2026) déroulait `toJSON` EN
 * BOUCLE sur la valeur résolue. C'est infidèle à `JSON.stringify` sur deux points, vérifiés
 * le 04/09/2026 par l'audit QA :
 * - un `Secret` porté par une propriété ORDINAIRE de l'objet renvoyé par `toJSON()`
 *   (`{ toJSON: () => ({ apiToken: secret, toJSON: () => "safe" }) }`) était masqué par le
 *   second passage de la boucle avant d'avoir pu être vu — alors que `JSON.stringify`
 *   n'appelle plus `toJSON` sur ce retour et sérialise bien `apiToken` ;
 * - un `toJSON` qui renvoie un objet neuf à chaque appel (`{ toJSON: () => fresh() }`) ne
 *   termine jamais : le `WeakSet` anti-cycle ne retient que des objets déjà vus, et chaque
 *   itération en produit un nouveau. `JSON.stringify` du même document termine
 *   instantanément, précisément parce qu'il n'appelle `toJSON` qu'une fois par propriété.
 */
function resolveJSONValue(value: unknown, key: string): unknown {
  // ECMA-262 §25.5.2.1 teste « value est un Object » — une fonction EST un Object, et
  // peut donc porter un `toJSON` que `JSON.stringify` appelle bel et bien (vérifié le
  // 04/09/2026 : `JSON.stringify({ a: Object.assign(() => {}, { toJSON: () => ({...}) }) })`
  // sérialise le retour de `toJSON`, pas `{}`). Se limiter à `typeof value === "object"`
  // — comme une première version de cette fonction, audit QA du 04/09/2026 — laissait
  // passer un `Secret` porté par une fonction ainsi augmentée : la garde ne la traitait
  // jamais comme un objet, ne lui trouvait donc pas de `toJSON`, et la récursion normale
  // rendait `null` en la traitant comme une valeur scalaire.
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "bigint" ||
    typeof value === "function"
  ) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      return (toJSON as (this: unknown, key: string) => unknown).call(value, key);
    }
  }
  return value;
}

/**
 * Refuse d'écrire une valeur qui porte encore un `Secret` : `JSON.stringify` appellerait son
 * `toJSON()` et écrirait le masque (`••••4f2a`) à la place du jeton. Le coffre serait
 * valide, et le jeton perdu — une panne silencieuse qui ne se manifesterait qu'au prochain
 * test de connexion, sous la forme d'un « jeton invalide » incompréhensible.
 *
 * Suit la même résolution `toJSON` que `JSON.stringify` (voir `resolveJSONValue`) pour
 * qu'un `Secret` non déballé ne puisse pas se cacher derrière un `toJSON` intermédiaire.
 * `isSecret` est testé sur la valeur BRUTE, avant résolution, puis sur la valeur RÉSOLUE :
 * un `Secret` peut être la valeur directement (son propre `toJSON` renvoie le masque, donc
 * le résoudre d'abord le rendrait indétectable), ou être exactement ce qu'un `toJSON`
 * intermédiaire renvoie (`{ toJSON: () => secret }`).
 *
 * Rend le chemin du champ fautif (`jira.apiToken`), jamais sa valeur.
 */
function findSecretPath(
  rawValue: unknown,
  path: string,
  key: string,
  seen: WeakSet<object>,
): string | null {
  if (isSecret(rawValue)) {
    return path === "" ? "(racine)" : path;
  }
  const value = resolveJSONValue(rawValue, key);
  if (isSecret(value)) {
    return path === "" ? "(racine)" : path;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const indexKey = String(index);
      const found = findSecretPath(
        value[index],
        `${path}[${indexKey}]`,
        indexKey,
        seen,
      );
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  for (const [childKey, child] of Object.entries(value)) {
    const found = findSecretPath(
      child,
      path === "" ? childKey : `${path}.${childKey}`,
      childKey,
      seen,
    );
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Chiffre un document JSON. Exposé — plutôt que caché derrière le magasin — pour deux
 * raisons concrètes : la sonde de vérification s'y attaque directement, et la v2 (clé par
 * compte) a besoin d'un chiffrement paramétré par la clé, pas par un emplacement de fichier.
 *
 * La clé n'apparaît dans aucun message renvoyé.
 */
export function encryptDocument(
  key: Buffer,
  document: unknown,
): VaultOutcome<string> {
  if (key.length !== KEY_BYTES) {
    return vaultError(
      "key_invalid",
      `Clé de chiffrement invalide : ${KEY_BYTES} octets attendus.`,
    );
  }

  // Parcourir le document exécute ses accesseurs (`get`) et ses pièges de Proxy : du code
  // applicatif, qui peut lever, et dont le message peut porter un jeton. Sans ce filet,
  // l'exception traverserait `write()` telle quelle — c'est précisément le canal de fuite
  // que le reste du module ferme. On refuse l'écriture plutôt que de persister un document
  // qu'on n'a pas pu inspecter.
  let secretPath: string | null;
  try {
    secretPath = findSecretPath(document, "", "", new WeakSet<object>());
  } catch {
    return vaultError(
      "invalid_payload",
      "La configuration à écrire n'a pas pu être inspectée (un accesseur de l'objet a levé une exception) : rien n'a été écrit.",
    );
  }
  if (secretPath !== null) {
    return vaultError(
      "invalid_payload",
      `La configuration à écrire contient une valeur Secret non déballée (${secretPath}) : le coffre aurait enregistré son masque à la place du jeton. Appelle revealSecret() dans encode().`,
    );
  }

  // INVARIANT, à charge d'`encode()` (BACK-4) : tout ce que le document expose en lecture —
  // `toJSON`, mais aussi un accesseur (`get`) ou un piège `get`/`ownKeys` de `Proxy` — doit
  // être PUR (même retour à chaque appel). `findSecretPath` et `JSON.stringify` ci-dessous
  // lisent chacun le document indépendamment, sur le MÊME document : une lecture non
  // déterministe, par n'importe lequel de ces trois mécanismes, pourrait donc montrer un
  // graphe sans `Secret` à la garde et un `Secret` au sérialiseur (vérifié le 04/09/2026,
  // y compris SANS aucun `toJSON` — un simple accesseur ou piège `Proxy` impur suffit).
  // `encode()` ne doit produire que des données JSON ordinaires ; les accesseurs, `Proxy`
  // et `toJSON` personnalisés n'appartiennent pas à ce module.
  let plaintext: string | undefined;
  try {
    plaintext = JSON.stringify(document);
  } catch {
    return vaultError(
      "invalid_payload",
      "La configuration à écrire n'est pas sérialisable en JSON (référence circulaire, valeur BigInt, ou `toJSON` qui lève).",
    );
  }
  if (plaintext === undefined) {
    return vaultError(
      "invalid_payload",
      "La configuration à écrire est vide (`undefined`) : rien n'a été écrit.",
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(ADDITIONAL_DATA);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const envelope: VaultEnvelope = {
    format: VAULT_FORMAT,
    v: VAULT_VERSION,
    alg: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ciphertext.toString("base64"),
  };
  return { status: "ok", value: `${JSON.stringify(envelope)}\n` };
}

/**
 * Déchiffre une enveloppe. Chaque cause d'échec a son `kind` : « fichier vide »,
 * « version inconnue » et « tag invalide » appellent trois conduites différentes.
 *
 * Aucun message ne contient d'extrait du clair déchiffré — les messages de `JSON.parse`
 * recopient une portion de leur entrée, ils ne sont donc jamais repris (cf. en-tête).
 */
export function decryptDocument(
  key: Buffer,
  envelopeText: string,
): VaultOutcome<unknown> {
  if (key.length !== KEY_BYTES) {
    return vaultError(
      "key_invalid",
      `Clé de chiffrement invalide : ${KEY_BYTES} octets attendus.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeText);
  } catch {
    return vaultError(
      "corrupted",
      "Le coffre chiffré n'est pas lisible : son enveloppe n'est pas un JSON valide (fichier vide, tronqué ou remplacé).",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return vaultError(
      "corrupted",
      "Le coffre chiffré n'est pas lisible : enveloppe inattendue.",
    );
  }

  const fields = parsed as Record<string, unknown>;
  if (readStringField(fields, "format") !== VAULT_FORMAT) {
    return vaultError(
      "corrupted",
      "Ce fichier n'est pas un coffre de cette application (marqueur de format absent ou différent).",
    );
  }

  const version = fields.v;
  if (typeof version !== "number") {
    return vaultError(
      "corrupted",
      "Le coffre chiffré n'est pas lisible : version d'enveloppe absente.",
    );
  }
  if (version !== VAULT_VERSION) {
    return vaultError(
      "unsupported_version",
      `Le coffre a été écrit au format version ${version}, que cette version de l'application ne sait pas lire (elle lit la version ${VAULT_VERSION}). Mets l'application à jour plutôt que de supprimer le fichier.`,
    );
  }
  if (readStringField(fields, "alg") !== ALGORITHM) {
    return vaultError(
      "corrupted",
      `Le coffre annonce un algorithme différent de ${ALGORITHM} : il n'est pas déchiffré.`,
    );
  }

  const ivText = readStringField(fields, "iv");
  const tagText = readStringField(fields, "tag");
  const ciphertextText = readStringField(fields, "ct");
  if (ivText === null || tagText === null || ciphertextText === null) {
    return vaultError(
      "corrupted",
      "Le coffre chiffré est incomplet : un des champs de l'enveloppe manque.",
    );
  }

  const iv = decodeBase64(ivText, IV_BYTES);
  const tag = decodeBase64(tagText, TAG_BYTES);
  const ciphertext = decodeBase64(ciphertextText);
  if (iv === null || tag === null || ciphertext === null) {
    return vaultError(
      "corrupted",
      "Le coffre chiffré est abîmé : un des champs de l'enveloppe n'est pas un base64 valide de la bonne longueur.",
    );
  }

  let plaintext: string;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(ADDITIONAL_DATA);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return vaultError(
      "decryption_failed",
      "Le coffre n'a pas pu être déchiffré : il a été modifié après son écriture, ou il a été chiffré avec une autre clé. Supprime le coffre et reconfigure les connexions ; les jetons ne sont pas récupérables.",
    );
  }

  try {
    return { status: "ok", value: JSON.parse(plaintext) as unknown };
  } catch {
    return vaultError(
      "invalid_content",
      "Le coffre a été déchiffré mais son contenu n'est pas un JSON valide.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Fichiers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Les permissions POSIX sont une couche de défense EN PLUS du chiffrement, pas la
 * protection principale : sur un système qui ne les applique pas (Windows, montage FAT),
 * l'échec est ignoré plutôt que de rendre l'application inutilisable. Le chiffrement, lui,
 * ne dépend pas du système de fichiers.
 */
async function relaxedChmod(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch {
    // Ignoré volontairement — voir le commentaire ci-dessus.
  }
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Le fichier temporaire n'existe pas ou plus : rien à nettoyer.
  }
}

async function ensureDirectory(
  location: VaultLocation,
): Promise<VaultOutcome<null>> {
  try {
    await mkdir(location.directory, { recursive: true, mode: DIRECTORY_MODE });
  } catch (error) {
    return fromSystemError(error, "créer le dossier", location.directory);
  }
  // `mkdir` applique l'umask du processus : on repose le mode explicitement.
  await relaxedChmod(location.directory, DIRECTORY_MODE);
  return { status: "ok", value: null };
}

type KeyReadResult =
  | VaultOkResult<Buffer>
  | { readonly status: "absent" }
  | VaultErrorResult;

/** Lit la clé. Ne la crée JAMAIS : la création est réservée au chemin d'écriture. */
async function readKeyFile(location: VaultLocation): Promise<KeyReadResult> {
  let raw: string;
  try {
    raw = await readFile(location.keyPath, "utf8");
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return { status: "absent" };
    }
    return fromSystemError(error, "lire la clé de chiffrement", location.keyPath);
  }

  const key = decodeBase64(raw.trim(), KEY_BYTES);
  if (key === null) {
    return vaultError(
      "key_invalid",
      `Le fichier de clé ${location.keyPath} ne contient pas une clé valide (${KEY_BYTES} octets en base64). Il a été modifié ou tronqué : le coffre ne peut plus être déchiffré.`,
    );
  }
  return { status: "ok", value: key };
}

/**
 * Rend la clé existante, ou en génère une au premier lancement (ticket, ligne 90).
 *
 * Deux précautions qui ne sont pas du confort :
 * - `flag: "wx"` échoue si le fichier existe déjà, au lieu de l'écraser. Sans cela, deux
 *   écritures simultanées pourraient remplacer une clé encore en usage et rendre le coffre
 *   indéchiffrable. Sur `EEXIST`, on relit celle qui a gagné.
 * - la clé n'est générée QUE sur le chemin d'écriture. Sur le chemin de lecture, une clé
 *   manquante face à un coffre présent est une erreur (`key_missing`) : en générer une
 *   nouvelle rendrait la perte définitive et silencieuse.
 */
async function loadOrCreateKey(
  location: VaultLocation,
): Promise<VaultOutcome<Buffer>> {
  const existing = await readKeyFile(location);
  if (existing.status !== "absent") {
    return existing;
  }

  const key = randomBytes(KEY_BYTES);
  try {
    const handle = await open(location.keyPath, "wx", FILE_MODE);
    try {
      await handle.writeFile(`${key.toString("base64")}\n`, "utf8");
      // Contrairement au coffre, il n'existe pas de version antérieure de la clé sur
      // laquelle retomber : sa perte est irréversible (voir plus haut). Le `fsync` est
      // donc au moins aussi justifié ici que sur `writeAtomically`.
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (errnoOf(error) === "EEXIST") {
      const raced = await readKeyFile(location);
      if (raced.status === "absent") {
        return vaultError(
          "key_missing",
          `La clé de chiffrement ${location.keyPath} a disparu pendant son écriture.`,
        );
      }
      return raced;
    }
    return fromSystemError(
      error,
      "écrire la clé de chiffrement",
      location.keyPath,
    );
  }

  await relaxedChmod(location.keyPath, FILE_MODE);
  return { status: "ok", value: key };
}

/**
 * Écriture atomique : fichier temporaire dans le même dossier (donc même système de
 * fichiers), `fsync`, puis `rename`. `rename` est atomique sur POSIX — à tout instant,
 * `config.enc` est soit l'ancien coffre complet, soit le nouveau, jamais un mélange.
 *
 * Le fichier temporaire naît en 0600 et le `rename` conserve ce mode : le contenu chiffré
 * n'est jamais visible, même brièvement, avec des droits plus larges.
 */
async function writeAtomically(
  location: VaultLocation,
  contents: string,
): Promise<VaultWriteResult> {
  const temporaryPath = `${location.configPath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", FILE_MODE);
    try {
      await handle.writeFile(contents, "utf8");
      // Sans `sync`, une coupure d'alimentation peut laisser un fichier vide après rename.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await relaxedChmod(temporaryPath, FILE_MODE);
    await rename(temporaryPath, location.configPath);
    return { status: "written" };
  } catch (error) {
    await removeQuietly(temporaryPath);
    return fromSystemError(error, "écrire le coffre", location.configPath);
  }
}

/* -------------------------------------------------------------------------- */
/* Magasin                                                                    */
/* -------------------------------------------------------------------------- */

export interface EncryptedStoreOptions<T> {
  /**
   * Valide le document déchiffré et le rend typé. C'est la frontière de parsing du coffre :
   * son contenu vient du disque, où il a pu être écrit par une version antérieure de
   * l'application. En cas de refus, `message` est affiché tel quel — il ne doit contenir ni
   * jeton ni extrait du document.
   */
  readonly decode: (document: unknown) => DecodeResult<T>;
  /**
   * Prépare la valeur à écrire. **Seul endroit où `revealSecret()` doit apparaître côté
   * persistance** : un `Secret` laissé dans le document fait échouer l'écriture
   * (`invalid_payload`).
   */
  readonly encode: (value: T) => unknown;
  /** Par défaut `~/.bcc`. Surchargé par les tests, et par la v2 pour une clé par compte. */
  readonly location?: VaultLocation;
}

export interface EncryptedStore<T> {
  readonly location: VaultLocation;
  /** Ne crée aucun fichier, pas même la clé. */
  read(): Promise<VaultReadResult<T>>;
  /** Remplace tout le contenu du coffre. */
  write(value: T): Promise<VaultWriteResult>;
  /**
   * Lecture-modification-écriture sérialisée. À préférer à `read` + `write` dès qu'un seul
   * bloc est modifié : `POST /api/settings` sauvegarde bloc par bloc et deux requêtes
   * peuvent être en vol simultanément (`docs/api-contracts.md`, §`POST /api/settings`) —
   * enchaîner soi-même `read` puis `write` perdrait alors une des deux écritures.
   *
   * `undefined` est passé au premier lancement (aucun coffre). Une lecture en ERREUR
   * interrompt la mise à jour : on n'écrase pas un coffre qu'on n'a pas su lire.
   */
  update(
    mutate: (current: T | undefined) => T | Promise<T>,
  ): Promise<VaultWriteResult>;
}

/**
 * Coffre chiffré typé.
 *
 * Le schéma appartient à l'appelant (BACK-4) via `encode` / `decode` : ce module ne connaît
 * ni les blocs Jira / Figma / IA, ni le marqueur d'onboarding, ni `lastError`. Il n'a donc
 * rien à réviser quand ce schéma bouge.
 */
export function createEncryptedStore<T>(
  options: EncryptedStoreOptions<T>,
): EncryptedStore<T> {
  const location = options.location ?? defaultVaultLocation();

  /**
   * File d'attente locale au processus : les écritures se suivent au lieu de se croiser.
   * Ne protège pas de deux processus concurrents (pas de verrou de fichier) — voir
   * l'en-tête du module.
   */
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<R>(task: () => Promise<R>): Promise<R> {
    const started = queue.then(task, task);
    queue = started.then(
      () => undefined,
      () => undefined,
    );
    return started;
  }

  async function readInternal(): Promise<VaultReadResult<T>> {
    let envelopeText: string;
    try {
      envelopeText = await readFile(location.configPath, "utf8");
    } catch (error) {
      if (errnoOf(error) === "ENOENT") {
        // Premier lancement : ce n'est pas une erreur, et surtout pas un coffre vide.
        return { status: "absent" };
      }
      return fromSystemError(error, "lire le coffre", location.configPath);
    }

    const key = await readKeyFile(location);
    if (key.status === "absent") {
      return vaultError(
        "key_missing",
        `Le coffre ${location.configPath} existe mais sa clé de chiffrement ${location.keyPath} est introuvable : son contenu n'est plus déchiffrable. Supprime le coffre et reconfigure les connexions.`,
      );
    }
    if (key.status === "error") {
      return key;
    }

    const decrypted = decryptDocument(key.value, envelopeText);
    if (decrypted.status === "error") {
      return decrypted;
    }

    let decoded: DecodeResult<T>;
    try {
      decoded = options.decode(decrypted.value);
    } catch {
      return vaultError(
        "invalid_content",
        "Le coffre a été déchiffré mais sa validation a échoué.",
      );
    }
    if (!decoded.ok) {
      return vaultError("invalid_content", decoded.message);
    }
    return { status: "loaded", value: decoded.value };
  }

  async function writeInternal(value: T): Promise<VaultWriteResult> {
    let document: unknown;
    try {
      document = options.encode(value);
    } catch {
      // L'exception d'origine n'est ni journalisée ni recopiée : elle vient du code
      // appelant, qui peut la tracer lui-même, et elle pourrait porter un jeton.
      return vaultError(
        "invalid_payload",
        "La préparation de la configuration à écrire a échoué : rien n'a été écrit.",
      );
    }
    if (isThenable(document)) {
      // `encode` doit être synchrone (voir `isThenable`) : on ne l'attend pas, on refuse.
      // L'attendre reviendrait à faire confiance à un contrat que le type n'impose pas.
      return vaultError(
        "invalid_payload",
        "encode() a renvoyé une Promise : cette fonction doit être synchrone. Rien n'a été écrit.",
      );
    }

    const directory = await ensureDirectory(location);
    if (directory.status === "error") {
      return directory;
    }

    const key = await loadOrCreateKey(location);
    if (key.status === "error") {
      return key;
    }

    const encrypted = encryptDocument(key.value, document);
    if (encrypted.status === "error") {
      return encrypted;
    }

    return writeAtomically(location, encrypted.value);
  }

  return {
    location,
    read: readInternal,
    write: (value) => enqueue(() => writeInternal(value)),
    update: (mutate) =>
      enqueue(async () => {
        const current = await readInternal();
        if (current.status === "error") {
          return current;
        }
        let next: T;
        try {
          next = await withTimeout(
            Promise.resolve(
              mutate(current.status === "loaded" ? current.value : undefined),
            ),
            UPDATE_MUTATE_TIMEOUT_MS,
            "update()",
          );
        } catch {
          return vaultError(
            "invalid_payload",
            "La mise à jour de la configuration a échoué (ou a dépassé le délai maximal) : rien n'a été écrit.",
          );
        }
        return writeInternal(next);
      }),
  };
}
