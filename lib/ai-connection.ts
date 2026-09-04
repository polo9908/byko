/**
 * BACK-3 — Test de connexion des 6 providers IA (`docs/tickets/phase-1-configuration.md`,
 * ligne 150).
 *
 * Ce module ne contient QUE la logique d'appel et de verdict. Le branchement HTTP
 * (`POST /api/settings/test-connection`) et la persistance (BACK-4) sont ailleurs :
 * `testAiConnection` est une fonction asynchrone sans état, testable sans serveur.
 *
 * DISPATCH — il n'y a volontairement aucun `if (provider === …)` ici. Toute la variation
 * entre providers (hôte, chemin, nom de l'en-tête d'authentification, codes HTTP d'une clé
 * refusée) vit dans `lib/providers-api.ts` (ARCHI-2b) et n'est lue qu'à travers
 * `getProviderApi`. Ajouter un 7ᵉ provider ne doit rien changer dans ce fichier.
 *
 * JETONS (`docs/api-contracts.md`, §Jetons ; en-tête de `lib/types/settings.ts`) — trois
 * règles tenues ici, et la raison de chacune :
 *
 * 1. La clé n'est lue que pour être passée à `buildTestRequest`, qui la pose dans un
 *    en-tête. Elle n'entre dans aucune URL, aucun message, aucune variable conservée.
 * 2. Le corps de réponse du provider N'EST JAMAIS LU, ni journalisé, ni réémis. Ce n'est
 *    pas de la prudence de principe : OpenAI répond « Incorrect API key provided:
 *    not-a-ke************0831 » et DeepSeek « Your api key: ****0831 is invalid » (limites
 *    relevées le 31/08/2026 dans `lib/providers-api.ts`). Relayer ce corps ferait
 *    transiter un fragment de clé vers le front, puis — via `lastError.message` que BACK-4
 *    écrit sur disque — le rendrait DURABLE. Tous les messages de ce fichier sont des
 *    constantes rédigées ici, jamais dérivées de la réponse.
 * 3. Aucun `console.*` dans ce module, même en cas d'échec inattendu. Un log de débogage
 *    qui recopie une réponse d'erreur est exactement la fuite décrite au point 2.
 *
 * Le verdict n'est construit qu'à partir du code HTTP (`status`) — une donnée non
 * sensible — et jamais du corps.
 *
 * SORTIE — chaque réponse est construite champ par champ, jamais par spread ni par
 * réutilisation d'un objet contenant les credentials (obligation explicite de l'en-tête
 * d'ARCHI-2 : le typage ne bloque pas une propriété excédentaire qui transite par une
 * variable).
 *
 * Ce module ne persiste rien (BACK-4) et ne valide pas le corps de la requête réseau : la
 * validation de `provider` contre la liste fermée reste à la frontière HTTP (ARCHI-2).
 */

import { getProviderApi, PROVIDERS_API } from "@/lib/providers-api";
import type {
  AiCredentials,
  AiTestConnectionResponse,
} from "@/lib/types/settings";

/* -------------------------------------------------------------------------- */
/* Réglages                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Délai maximal d'un test, en millisecondes. Le test se déclenche automatiquement au blur
 * (règle produit, ligne 10) : l'utilisateur attend devant un spinner, une requête qui pend
 * fige le bloc. 10 s laisse passer un appel lent sans immobiliser l'écran.
 *
 * Exporté pour que les tests puissent l'abaisser sans dupliquer la valeur.
 */
export const AI_TEST_TIMEOUT_MS = 10_000;

/**
 * Signature minimale de `fetch` réellement utilisée ici. Déclarée à part pour permettre
 * l'injection d'un double en test (six providers × plusieurs verdicts, sans réseau) sans
 * avoir à remplacer le `fetch` global du processus.
 */
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Points d'injection réservés aux tests. La route HTTP appelle sans ce paramètre. */
export interface TestAiConnectionOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Messages — rédigés ici, jamais dérivés d'une réponse provider               */
/* -------------------------------------------------------------------------- */

/**
 * Libellé exigé au mot près par le critère d'acceptation de BACK-3 (ligne 162) et par la
 * maquette du bloc « Modèle IA », état ❌. FRONT-3 affiche ce message tel quel : le
 * reformuler ferait diverger l'écran de la maquette.
 */
const MESSAGE_INVALID_TOKEN = "jeton invalide ou expiré";

const MESSAGE_QUOTA_EXCEEDED =
  "quota ou limite de requêtes atteint chez le provider ; la clé n'a pas pu être vérifiée. Patientez quelques minutes, ou vérifiez le quota et la facturation de votre compte chez le provider, puis réessayez.";

const MESSAGE_TIMEOUT =
  "le provider n'a pas répondu dans le délai imparti ; la clé n'a pas pu être vérifiée. Vérifiez votre connexion réseau, puis réessayez.";

const MESSAGE_NETWORK =
  "impossible de joindre le provider ; la clé n'a pas pu être vérifiée. Vérifiez votre connexion réseau (ou un éventuel proxy d'entreprise), puis réessayez.";

/**
 * Un `2xx` dont le `content-type` ne porte pas `json` n'est pas un succès crédible : un
 * proxy d'entreprise qui intercepte le TLS renvoie typiquement une page de connexion `200`
 * `text/html`, et un `200` au corps vide n'a pas non plus de `content-type` JSON. Traiter
 * l'un ou l'autre comme un succès ferait persister (BACK-4) une clé jamais réellement
 * vérifiée. Seul l'en-tête est lu, jamais le corps (règle 2 de l'en-tête).
 *
 * NON VÉRIFIÉ (contrairement au reste de `lib/providers-api.ts`, où chaque valeur porte sa
 * sonde) : que les six routes renvoient bien `content-type: application/json` sur un `200`
 * réel — aucune clé valide n'est disponible dans cet environnement pour l'observer. Le
 * risque n'est pas théorique : une sonde sans clé sur `api.deepseek.com/models` montre que
 * ce provider répond à son `401` SANS aucun `content-type` ; si son `200` fait de même, une
 * clé DeepSeek valide serait à tort rejetée. `endpointProven: false` couvre déjà cette
 * incertitude pour DeepSeek (`lib/providers-api.ts`) ; ce risque de faux négatif sur le
 * `content-type` s'y ajoute et concerne potentiellement les six providers, pas seulement
 * DeepSeek. À confirmer par BACK-3 au premier test avec une clé réelle par provider ; si
 * l'un d'eux échoue le test alors que sa clé est valide, c'est cette exigence qu'il faut
 * assouplir pour ce provider précis dans `lib/providers-api.ts`, pas ici.
 */
const MESSAGE_UNVERIFIABLE_RESPONSE =
  "réponse du provider inexploitable (contenu inattendu) ; la clé n'a pas pu être vérifiée. Réessayez, et si le problème persiste signalez-le.";

/** Le code HTTP est une donnée non sensible : il aide au diagnostic sans rien exposer. */
function messageServerError(status: number): string {
  return `le provider a répondu par une erreur de son côté (code HTTP ${status}) ; la clé n'a pas pu être vérifiée. Réessayez dans quelques minutes.`;
}

function messageUnexpectedStatus(status: number): string {
  return `réponse inattendue du provider (code HTTP ${status}) ; la clé n'a pas pu être vérifiée. Réessayez, et si le problème persiste signalez ce code.`;
}

/* -------------------------------------------------------------------------- */
/* Constructeurs de réponse — champ par champ, jamais par spread               */
/* -------------------------------------------------------------------------- */

function success(): AiTestConnectionResponse {
  return { block: "ai", status: "success" };
}

function invalidToken(): AiTestConnectionResponse {
  return {
    block: "ai",
    status: "error",
    message: MESSAGE_INVALID_TOKEN,
    code: "invalid_token",
  };
}

function quotaExceeded(): AiTestConnectionResponse {
  return {
    block: "ai",
    status: "error",
    message: MESSAGE_QUOTA_EXCEEDED,
    code: "quota_exceeded",
  };
}

function providerUnavailable(message: string): AiTestConnectionResponse {
  return {
    block: "ai",
    status: "error",
    message,
    code: "provider_unavailable",
  };
}

/**
 * Échec sans code : aucun des trois codes du contrat ne décrit honnêtement une requête
 * malformée (ni clé refusée, ni quota, ni panne provider). Le contrat le prévoit
 * explicitement, `code` reste optionnel pour ce genre de cas.
 */
function malformedRequest(message: string): AiTestConnectionResponse {
  return { block: "ai", status: "error", message };
}

/* -------------------------------------------------------------------------- */
/* Utilitaires                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Vrai si l'échec du `fetch` vient de notre propre délai maximal. `AbortSignal.timeout`
 * rejette avec un `DOMException` nommé `TimeoutError` ; certains runtimes remontent
 * `AbortError`. Seul le NOM de l'erreur est inspecté : ni son message, ni sa cause, ni le
 * corps de réponse ne sont lus (règle 2 de l'en-tête).
 */
function isTimeoutError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (typeof error !== "object" || error === null) return false;
  const name: unknown = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Libère la connexion sans lire le corps. `await` volontaire : laisser une promesse
 * flottante ferait remonter un rejet non géré après le retour de la fonction. Le contenu
 * n'est jamais matérialisé — c'est précisément ce qui garantit qu'aucun fragment de clé
 * recopié par OpenAI ou DeepSeek n'entre dans ce processus.
 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Corps déjà clos ou connexion coupée : sans effet sur le verdict, qui ne dépend
    // que du code HTTP.
  }
}

/* -------------------------------------------------------------------------- */
/* Test de connexion                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Valide une clé API auprès du provider choisi, par un appel en LECTURE SEULE
 * (`GET` sur une route de type « list models ») : aucune génération de contenu, donc aucun
 * coût en jetons pour l'utilisateur (critère d'acceptation, ligne 163). Le type
 * `ProviderTestRequest` d'ARCHI-2b fige `method: "GET"`, ce qui rend un appel de
 * génération non représentable.
 *
 * Ne lève jamais : tout échec est traduit en variante `status: "error"` du contrat.
 */
export async function testAiConnection(
  credentials: AiCredentials,
  options: TestAiConnectionOptions = {},
): Promise<AiTestConnectionResponse> {
  // `credentials` est typé par `AiCredentials`, mais un corps de requête HTTP mal formé
  // n'est pas garanti par le typage (invariant documenté en tête de
  // `lib/types/settings.ts`) : `credentials` lui-même absent, un `provider` hors liste, ou
  // un `apiToken` absent feraient lever un `TypeError` plus bas, contredisant la garantie
  // « ne lève jamais » ci-dessus. D'où le contrôle de `credentials` avant celui de ses champs.
  if (
    typeof credentials !== "object" ||
    credentials === null ||
    typeof credentials.apiToken !== "string" ||
    !Object.hasOwn(PROVIDERS_API, credentials.provider)
  ) {
    return malformedRequest(
      "La requête de test de connexion au modèle IA est incomplète ou mal formée.",
    );
  }

  const apiKey = credentials.apiToken.trim();

  // Clé vide : le provider répondrait « credentials absents » (401/403 selon les
  // hôtes sondés le 31/08/2026), ce qui est déjà le verdict ci-dessous. On l'évite,
  // le résultat est identique et aucun appel réseau inutile n'est émis.
  if (apiKey.length === 0) {
    return invalidToken();
  }

  const entry = getProviderApi(credentials.provider);
  const request = entry.buildTestRequest(apiKey);

  const doFetch: FetchLike = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? AI_TEST_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await doFetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
      // `redirect: "error"` plutôt que le suivi par défaut : la spécification `fetch` ne
      // retire l'en-tête `Authorization` que sur une redirection inter-origine, et NE
      // retire jamais un en-tête propriétaire — or quatre providers passent la clé par
      // `x-api-key` (Anthropic) ou `x-goog-api-key` (Gemini). Une redirection, même
      // légitime, enverrait donc la clé de l'utilisateur à un hôte que ce dépôt n'a
      // jamais sondé. Aucune des six URL de la table n'en émet (sondes du 31/08/2026) :
      // une redirection fait donc rejeter le `fetch` (comportement de `redirect: "error"`),
      // et ressort ci-dessous par le `catch`, classée en "provider injoignable" faute de
      // meilleure catégorie — ce n'est pas un problème réseau, mais aucun des trois codes
      // du contrat ne nomme ce cas.
      redirect: "error",
      // Aucun cache : le verdict doit refléter l'état réel de la clé à cet instant.
      cache: "no-store",
    });
  } catch (error: unknown) {
    // Ni le message ni la cause de l'erreur ne sont lus : sur certains runtimes ils
    // recopient l'URL et les en-têtes de la requête, donc la clé.
    return providerUnavailable(
      isTimeoutError(error, signal) ? MESSAGE_TIMEOUT : MESSAGE_NETWORK,
    );
  }

  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  await discardBody(response);

  // 1. Clé refusée. Les codes ne sont PAS uniformes (401 chez Anthropic, OpenAI, DeepSeek
  //    et Kimi ; 400 aussi chez Grok ; 400/403 chez Gemini) : c'est la table qui décide,
  //    jamais une supposition locale. Testé en premier car c'est le cas le plus fréquent
  //    et le seul dont le libellé est imposé par la maquette.
  if (entry.invalidKeyStatuses.includes(status)) {
    // CAS RÉSIDUEL DEEPSEEK (`probe.endpointProven === false`) : la passerelle DeepSeek
    // authentifie AVANT de router, et un chemin inexistant renvoie le même 401 qu'une clé
    // refusée. Un `invalid_token` sur DeepSeek peut donc aussi signifier « `/models`
    // n'est pas le bon chemin ». Rien ne les distingue depuis l'extérieur, et aucune
    // branche supplémentaire ne le pourrait : le point sera tranché au premier test avec
    // une clé DeepSeek réelle (si une clé valide est refusée, c'est le chemin qu'il faut
    // corriger dans `lib/providers-api.ts`, pas ce fichier).
    return invalidToken();
  }

  // 2. Quota / limite de débit, distingué de la clé invalide (exigence ligne 158). Placé
  //    après la table : aucun provider n'a 429 dans `invalidKeyStatuses` aujourd'hui, mais
  //    si l'un venait à l'y inscrire, sa donnée observée doit primer sur cette règle
  //    générale.
  if (status === 429) {
    return quotaExceeded();
  }

  // 3. Panne côté provider.
  if (status >= 500) {
    return providerUnavailable(messageServerError(status));
  }

  // 4. Succès — restreint aux 2xx.
  //    Écart assumé avec la formulation « statut hors `invalidKeyStatuses`, pas 429, pas
  //    5xx » du ticket : un 404 ou un 402 n'est en aucun cas une preuve que la clé
  //    fonctionne. Chez DeepSeek en particulier, dont le chemin n'est pas prouvé, annoncer
  //    « connecté » sur un 404 ferait croire à une configuration valide et l'échec
  //    n'apparaîtrait qu'au moment de l'analyse d'un ticket. Un statut non classé est donc
  //    une indétermination, pas un succès.
  if (response.ok) {
    if (!contentType.toLowerCase().includes("json")) {
      return providerUnavailable(MESSAGE_UNVERIFIABLE_RESPONSE);
    }
    return success();
  }

  return providerUnavailable(messageUnexpectedStatus(status));
}
