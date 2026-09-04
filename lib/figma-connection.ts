/**
 * BACK-2 — Test de connexion Figma (`docs/tickets/phase-1-configuration.md`, ligne 133).
 *
 * Ce module contient la LOGIQUE seule : une fonction asynchrone qui prend un jeton et
 * rend un verdict conforme au contrat d'ARCHI-2. Le branchement HTTP
 * (`POST /api/settings/test-connection`) et la persistance (BACK-4) sont ailleurs ;
 * rien n'est écrit sur disque ici, et aucune session/route n'est touchée.
 *
 * MODULE SERVEUR UNIQUEMENT. Il reçoit un jeton en clair : l'importer depuis un
 * composant client l'embarquerait dans le bundle navigateur. Aucun `"server-only"`
 * n'est importé pour ne pas ajouter de dépendance runtime (même parti pris que
 * `lib/providers-api.ts`, qui n'importe qu'un type) ; la garantie repose sur l'appelant.
 *
 * JETONS (`docs/api-contracts.md`, §Jetons ; ARCHI-3) :
 * - le jeton n'apparaît QUE dans l'en-tête `X-Figma-Token` de la requête sortante.
 *   Jamais dans l'URL — une URL finit dans les journaux d'accès, les traces et les
 *   rapports d'erreur ;
 * - aucun `console.*` dans ce fichier, volontairement. Pas même en débogage : une seule
 *   fuite dans un dépôt public est définitive ;
 * - aucun message rendu ici ne concatène le jeton, ni un fragment, ni sa longueur, et
 *   aucun corps de réponse de Figma n'est réémis tel quel (leçon de `lib/providers-api.ts` :
 *   OpenAI et DeepSeek recopient un fragment de la clé dans leurs messages d'erreur ;
 *   les sondes du 04/09/2026 ci-dessous montrent que Figma ne le fait pas — « Invalid
 *   token » sans écho —, mais on ne relaie pas davantage un texte anglais non maîtrisé) ;
 * - les réponses sont construites champ par champ, jamais par spread d'un objet portant
 *   les credentials (obligation posée en en-tête de `lib/types/settings.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVENANCE DES VALEURS — vérification par requête réelle, le 04/09/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Même règle de non-invention que `lib/providers-api.ts` : l'URL et le nom de l'en-tête
 * ne sont pas écrits de mémoire. Sondes faites SANS jeton valide (aucun jeton Figma
 * n'est disponible dans ce projet), avec une chaîne de remplissage qui n'en est pas un :
 *
 *   GET https://api.figma.com/v1/me                → 401 {"status":401,"err":"Missing credentials"}
 *   GET https://api.figma.com/v1/zzz-does-not-exist → 404 {"status":404,"err":"Not found"}
 *
 * La sonde de contrôle répond 404 : le serveur ROUTE avant d'authentifier, donc le 401
 * de `/v1/me` prouve bien que ce chemin existe (contrairement au cas DeepSeek).
 *
 *   GET /v1/me + `X-Figma-Token: <remplissage>`     → 401 {"status":401,"err":"Invalid token"}
 *
 * Le corps passe de « Missing credentials » à « Invalid token » : le serveur LIT bien ce
 * canal, l'en-tête est confirmé par le comportement et non supposé. Confirmé aussi :
 * un jeton refusé sort en **401** (et non 400 comme Grok/Gemini).
 *
 * NON VÉRIFIÉ, faute de jeton réel — points à confirmer au premier test avec un vrai jeton :
 * - la FORME du corps de succès de `/v1/me` (champs `id` / `handle` / `email` / `img_url`).
 *   D'où la lecture défensive de `readAccountName` plus bas, et le garde-fou « succès
 *   méconnaissable » : on ne fabrique pas un succès à partir d'un corps qu'on ne
 *   reconnaît pas ;
 * - le code exact rendu par un jeton dont la PORTÉE est insuffisante (403 attendu, non
 *   observé) — d'où un message distinct sur 403, mais sans citer de nom de portée qu'aucune
 *   sonde n'a confirmé ;
 * - la forme réelle du 429 (présence et unité de `Retry-After`) — d'où sa lecture
 *   prudente, bornée, et purement facultative dans le message.
 */

import type {
  FigmaAccountInfo,
  FigmaCredentials,
  FigmaTestConnectionErrorCode,
  FigmaTestConnectionResponse,
  FigmaTestConnectionSuccess,
} from "@/lib/types/settings";

/* -------------------------------------------------------------------------- */
/* Constantes                                                                 */
/* -------------------------------------------------------------------------- */

/** Endpoint de vérification, prouvé par la sonde du 04/09/2026 (voir en-tête). */
export const FIGMA_ME_URL = "https://api.figma.com/v1/me";

/**
 * Délai maximal d'un test, couvrant l'établissement de la connexion ET la lecture du
 * corps. Le test est déclenché au blur du champ (règle produit, ligne 10) : l'utilisateur
 * attend devant un spinner, une attente plus longue serait perçue comme un blocage. Un
 * appel qui pend sans limite figerait la route qui appellera cette fonction.
 */
export const FIGMA_TEST_TIMEOUT_MS = 10_000;

/**
 * Un jeton est posé dans un en-tête HTTP : il doit tenir dans les caractères qu'un
 * en-tête accepte. Un jeton collé avec un retour à la ligne, une espace insécable ou un
 * caractère accentué fait lever `TypeError` à la construction de la requête — une panne
 * qui, sans ce contrôle, serait indistinguable d'une coupure réseau et afficherait un
 * message faux. On vérifie donc AVANT l'appel : ASCII visible, sans espace.
 * Ce n'est PAS une validation de format Figma (aucun préfixe n'est exigé ici : le
 * préfixe des jetons personnels n'a été confirmé par aucune sonde, et le supposer
 * ferait rejeter à tort un jeton valide d'une autre forme).
 */
const HEADER_SAFE_TOKEN = /^[\x21-\x7e]+$/;

/** Bornes de lecture de `Retry-After` : au-delà, la valeur n'est pas exploitable. */
const RETRY_AFTER_MIN_SECONDS = 1;
const RETRY_AFTER_MAX_SECONDS = 3600;

/* -------------------------------------------------------------------------- */
/* Constructeurs de réponse — champ par champ, jamais par spread                */
/* -------------------------------------------------------------------------- */

/**
 * `code` est explicitement optionnel : le contrat ne connaît que `invalid_token` et
 * `rate_limited` (ARCHI-2, `FigmaTestConnectionErrorCode`). Un timeout, une coupure
 * réseau ou un 500 de Figma sortent donc SANS code plutôt que rangés dans une catégorie
 * fausse — `message` reste la seule source d'affichage (FRONT-3).
 */
function figmaError(
  message: string,
  code?: FigmaTestConnectionErrorCode,
): FigmaTestConnectionResponse {
  return code === undefined
    ? { block: "figma", status: "error", message }
    : { block: "figma", status: "error", message, code };
}

/**
 * `account` n'est posé que si un nom d'affichage a réellement été lu : BACK-2 ne le
 * promet que « si disponible » (ligne 139) et le contrat le rend optionnel. On ne
 * fabrique pas de nom de remplacement.
 */
function figmaSuccess(account?: FigmaAccountInfo): FigmaTestConnectionSuccess {
  return account === undefined
    ? { block: "figma", status: "success" }
    : { block: "figma", status: "success", account };
}

/* -------------------------------------------------------------------------- */
/* Lecture de la réponse                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `AbortSignal.timeout()` rejette avec un `DOMException` nommé `TimeoutError` ; un abort
 * explicite donnerait `AbortError`. On teste le NOM sur une valeur `unknown` plutôt que
 * `instanceof DOMException`, qui n'est pas garanti selon le runtime (Node / Edge).
 */
function isTimeoutLike(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("name" in cause)) {
    return false;
  }
  const { name } = cause as { name?: unknown };
  return name === "TimeoutError" || name === "AbortError";
}

/** Chaîne exploitable comme nom affichable : non vide une fois les blancs retirés. */
function readableString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Nom de compte à afficher. Volontairement limité à `handle` — le champ le plus proche
 * d'un nom d'affichage chez Figma. `email` n'est PAS un repli : `lib/jira-connection.ts`
 * (invariant 4) tranche que l'adresse e-mail d'un compte ne ressort jamais d'un module de
 * test de connexion, cette valeur étant rendue durable par BACK-4 puis réaffichée par
 * FRONT-12 — même position ici, pour la même donnée. Si `handle` est absent, on renvoie
 * `undefined` : succès sans `account`, ce que le contrat autorise explicitement (BACK-2,
 * ligne 139 : « si disponible »).
 */
function readAccountName(body: Record<string, unknown>): string | undefined {
  return readableString(body["handle"]);
}

/**
 * Le corps ressemble-t-il à la réponse de `/v1/me` ? Garde-fou contre le SUCCÈS VIDE :
 * un `200 OK` dont le corps ne porte aucun des champs attendus n'est pas la preuve qu'un
 * jeton est valide — c'est typiquement ce que renvoie un portail captif, un proxy
 * d'entreprise ou une page d'interstitiel qui répond 200 à tout. Annoncer « connecté »
 * sur cette base ferait échouer l'analyse bien plus tard, sans rapport visible avec la
 * vraie cause.
 *
 * La forme exacte du corps n'ayant pas pu être vérifiée avec un jeton réel (voir
 * en-tête), le test est volontairement LARGE : un seul des trois champs suffit. Un
 * renommage côté Figma se traduirait par une indétermination explicite, jamais par un
 * faux succès ni par un faux « jeton invalide ».
 */
function looksLikeFigmaUser(body: Record<string, unknown>): boolean {
  return "id" in body || "handle" in body || "email" in body;
}

/**
 * `Retry-After` peut être un nombre de secondes ou une date HTTP. Seule la forme entière
 * et bornée est exploitée ; toute autre valeur est ignorée plutôt qu'interprétée de
 * travers. La valeur n'est qu'un COMPLÉMENT au message, jamais sa condition.
 */
function readRetryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const seconds = Number(trimmed);
  return seconds >= RETRY_AFTER_MIN_SECONDS && seconds <= RETRY_AFTER_MAX_SECONDS
    ? seconds
    : undefined;
}

/* -------------------------------------------------------------------------- */
/* Messages — français, précis, actionnables (FRONT-3 : jamais générique)       */
/* -------------------------------------------------------------------------- */

const MESSAGE_EMPTY_TOKEN =
  "Aucun jeton Figma saisi. Colle le jeton personnel généré depuis Figma, " +
  "menu de compte › Settings › Security › Personal access tokens.";

const MESSAGE_MALFORMED_TOKEN =
  "Ce jeton contient des caractères que Figma ne peut pas recevoir (retour à la ligne, " +
  "espace ou caractère accentué). Recopie-le depuis Figma sans rien ajouter autour, " +
  "puis recolle-le.";

const MESSAGE_INVALID_TOKEN =
  "Figma a refusé ce jeton : il est invalide, expiré ou révoqué. Génère un nouveau jeton " +
  "personnel dans Figma › Settings › Security › Personal access tokens, puis recolle-le.";

const MESSAGE_FORBIDDEN =
  "Figma a reconnu ce jeton mais refuse de lire ton compte : ses droits sont " +
  "insuffisants, ou ton organisation restreint les jetons personnels. Régénère un jeton " +
  "en lui donnant l'accès en lecture à ton profil, ou demande l'autorisation à " +
  "l'administrateur de ton organisation Figma.";

const MESSAGE_RATE_LIMITED = "Trop de tentatives, réessaie dans quelques instants.";

const MESSAGE_TIMEOUT =
  `Figma n'a pas répondu en moins de ${Math.round(FIGMA_TEST_TIMEOUT_MS / 1000)} secondes. ` +
  "Vérifie ta connexion internet (ou ton proxy d'entreprise) et relance le test : " +
  "le jeton n'a pas été jugé, seule la réponse manque.";

const MESSAGE_NETWORK =
  "Impossible de joindre api.figma.com. Vérifie ta connexion internet, ton VPN ou ton " +
  "proxy, puis relance le test : le jeton n'a pas été jugé.";

const MESSAGE_UNREADABLE_BODY =
  "Figma a répondu, mais sa réponse n'a pas pu être lue comme une réponse de l'API Figma. " +
  "Un proxy ou un portail de connexion Wi-Fi intercepte peut-être l'appel. " +
  "Le jeton n'a donc pas pu être vérifié : relance le test depuis un réseau direct.";

function unavailableMessage(status: number): string {
  return (
    `Figma est momentanément indisponible (erreur ${status} de son côté). ` +
    "Réessaie dans quelques instants : le jeton n'a pas été jugé."
  );
}

function unexpectedStatusMessage(status: number): string {
  return (
    `Figma a répondu de façon inattendue (code HTTP ${status}) et le jeton n'a pas pu ` +
    "être vérifié. Réessaie ; si le code persiste, signale-le avec ce numéro."
  );
}

function rateLimitedMessage(retryAfterSeconds: number | undefined): string {
  if (retryAfterSeconds === undefined) return MESSAGE_RATE_LIMITED;
  const delay =
    retryAfterSeconds === 1 ? "1 seconde" : `${retryAfterSeconds} secondes`;
  return `${MESSAGE_RATE_LIMITED} Figma indique un délai d'environ ${delay}.`;
}

/* -------------------------------------------------------------------------- */
/* Fonction principale                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Teste un jeton Figma par un appel de lecture minimal à `GET /v1/me`.
 *
 * Ne persiste rien, ne journalise rien, ne lève jamais : tout échec — y compris une
 * coupure réseau ou un timeout — ressort comme une variante d'erreur du contrat, pour que
 * l'appelant n'ait pas de `try/catch` à écrire et qu'aucune trace d'exception ne puisse
 * emporter le jeton.
 *
 * AUCUN RÉESSAI, délibérément : sur 401/403 le jeton ne s'améliorera pas et insister peut
 * faire bloquer le compte ; sur 429 un réessai automatique aggrave exactement ce que le
 * 429 signale, alors que le test est déjà rejoué au prochain blur du champ.
 *
 * Le paramètre est typé, mais la valeur peut venir du réseau : la route reste chargée de
 * valider le corps de requête à la frontière (ARCHI-2). Les contrôles faits ici sur le
 * jeton sont ceux dont l'APPEL a besoin, pas cette validation.
 */
export async function testFigmaConnection(
  credentials: FigmaCredentials,
): Promise<FigmaTestConnectionResponse> {
  const rawToken: unknown = credentials?.apiToken;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  if (token === "") {
    return figmaError(MESSAGE_EMPTY_TOKEN, "invalid_token");
  }
  if (!HEADER_SAFE_TOKEN.test(token)) {
    return figmaError(MESSAGE_MALFORMED_TOKEN, "invalid_token");
  }

  let response: Response;
  try {
    response = await fetch(FIGMA_ME_URL, {
      method: "GET",
      headers: {
        // Canal d'authentification des jetons personnels Figma, confirmé par sonde
        // (voir en-tête). Pas de préfixe `Bearer` : ce n'est pas un jeton OAuth.
        "X-Figma-Token": token,
        Accept: "application/json",
      },
      // Une réponse authentifiée par jeton ne doit jamais entrer dans un cache partagé :
      // le défaut de Next 16 est déjà « non mis en cache », `no-store` le rend explicite
      // et immunise contre un `fetchCache` de segment qui forcerait la mise en cache.
      cache: "no-store",
      // Un jeton posé dans un en-tête CUSTOM n'est PAS retiré par la spécification fetch
      // lors d'une redirection cross-origin (seuls `Authorization`, `Cookie` et
      // `Proxy-Authorization` le sont) : suivre une redirection pourrait donc envoyer le
      // jeton à un autre hôte. `/v1/me` n'en émet pas (sonde du 04/09/2026) ; refuser les
      // redirections coûte donc zéro et ferme la fuite.
      redirect: "error",
      signal: AbortSignal.timeout(FIGMA_TEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // `cause` n'est ni journalisé ni réémis : son `message` peut contenir l'URL appelée
    // et du texte non maîtrisé. Seul son nom sert à distinguer timeout et panne réseau.
    return isTimeoutLike(cause)
      ? figmaError(MESSAGE_TIMEOUT)
      : figmaError(MESSAGE_NETWORK);
  }

  if (!response.ok) {
    const { status } = response;
    if (status === 401) return figmaError(MESSAGE_INVALID_TOKEN, "invalid_token");
    if (status === 403) return figmaError(MESSAGE_FORBIDDEN, "invalid_token");
    if (status === 429) {
      return figmaError(
        rateLimitedMessage(readRetryAfterSeconds(response.headers)),
        "rate_limited",
      );
    }
    if (status >= 500) return figmaError(unavailableMessage(status));
    // 400, 404 et consorts : `/v1/me` existe (sonde de contrôle en 404 sur un chemin
    // bidon), donc un 4xx autre que ceux ci-dessus n'est pas un verdict sur le jeton.
    // Le ranger dans `invalid_token` afficherait une cause fausse.
    return figmaError(unexpectedStatusMessage(status));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    // Le délai maximal couvre aussi la lecture du corps : un flux qui ne se termine pas
    // ressort en timeout, pas en « réponse illisible ».
    return isTimeoutLike(cause)
      ? figmaError(MESSAGE_TIMEOUT)
      : figmaError(MESSAGE_UNREADABLE_BODY);
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return figmaError(MESSAGE_UNREADABLE_BODY);
  }

  const body = payload as Record<string, unknown>;
  if (!looksLikeFigmaUser(body)) {
    return figmaError(MESSAGE_UNREADABLE_BODY);
  }

  const accountName = readAccountName(body);
  return accountName === undefined
    ? figmaSuccess()
    : figmaSuccess({ accountName });
}
