/**
 * ARCHI-2b — Table d'appel des 6 providers IA, moitié BACK.
 * Pendant front : `lib/providers-links.ts` (labels + URL « Créer jeton »).
 *
 * Consommé UNIQUEMENT par le back, dans BACK-3
 * (`docs/tickets/phase-1-configuration.md`, ligne 150).
 *
 * SÉPARATION FRONT / BACK (critère d'acceptation, ligne 73) — ce fichier n'importe qu'un
 * TYPE (`ProviderId`) et rien d'autre : aucun import de `lib/providers-links.ts`, aucun
 * import Next, aucune dépendance npm (contrainte ARCHI-1 ligne 30 : `fetch` natif seul).
 * Il ne contient délibérément AUCUN label d'affichage ni URL de console : ce sont les
 * données de la table front, les dupliquer ici recréerait exactement le couplage que ce
 * ticket existe pour supprimer.
 *
 * JETONS (`docs/api-contracts.md`, §Jetons) — la clé est un PARAMÈTRE de
 * `buildTestRequest`, jamais une valeur de ce fichier. Elle ne figure que dans les
 * en-têtes de la requête construite : jamais dans l'URL (une URL finit dans les logs
 * d'accès, les traces et les rapports d'erreur), jamais dans un message. Ce module
 * n'exécute rien, ne journalise rien et ne construit aucun message d'erreur.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVENANCE DES VALEURS — vérification par requête réelle, le 31/08/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Règle de non-invention : aucune URL, aucun nom d'en-tête n'est écrit ici de mémoire.
 * Chaque valeur est accompagnée de l'URL exacte sondée et du code HTTP obtenu.
 *
 * Toutes les sondes ont été faites SANS jeton. `401`/`403` = l'hôte et le chemin
 * existent et exigent une authentification, ce qui est la meilleure confirmation
 * possible en l'absence de clé.
 *
 * SONDE DE CONTRÔLE, indispensable pour que le `401` veuille dire quelque chose : un
 * chemin volontairement faux a été sondé sur chaque hôte. S'il répond `404`, alors le
 * serveur route AVANT d'authentifier, et le `401` du vrai chemin prouve bien que ce
 * chemin existe. S'il répond `401` lui aussi, le serveur authentifie AVANT de router et
 * le `401` ne prouve plus rien — c'est le cas de DeepSeek (voir son entrée).
 *
 * Le canal d'authentification (nom de l'en-tête) a été confirmé par le comportement
 * observé, jamais supposé : soit le serveur le nomme dans sa réponse, soit l'envoi de
 * l'en-tête candidat — avec une chaîne de remplissage qui n'est pas une clé — change le
 * message d'erreur, ce qui prouve que le serveur lit ce canal. Ce qui n'a pas pu être
 * confirmé ainsi est marqué « À CONFIRMER PAR BACK-3 » à l'endroit exact concerné.
 */

import type { ProviderId } from "@/lib/types/settings";

/* -------------------------------------------------------------------------- */
/* Forme de la table                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Requête de test DÉCRITE, pas exécutée. `buildTestRequest` est une fonction pure : elle
 * ne fait pas d'appel réseau et ne journalise rien, pour que BACK-3 garde la main sur le
 * délai maximal, l'`AbortSignal` et la lecture de la réponse.
 *
 * Directement consommable par le `fetch` natif :
 * `fetch(req.url, { method: req.method, headers: req.headers, signal })`.
 *
 * `method` est le littéral `"GET"` et non `string` : le critère d'acceptation de BACK-3
 * (ligne 163) interdit « tout appel coûteux (pas de génération de contenu réelle) » pour
 * tester une clé. En figeant la méthode à `GET`, ce type rend un appel de génération —
 * qui est toujours un `POST` chez les 6 providers — non représentable ici. Un futur
 * provider qui n'aurait qu'une route de vérification en `POST` obligera à élargir ce
 * type, donc à rouvrir la discussion sur le coût de l'appel plutôt qu'à la contourner.
 */
export interface ProviderTestRequest {
  readonly url: string;
  readonly method: "GET";
  /** Seul endroit où la clé apparaît. Jamais dans `url`. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Trace de la vérification du 31/08/2026, conservée dans les DONNÉES et pas seulement en
 * commentaire : BACK-3 en a besoin pour écrire des messages honnêtes, et un relecteur
 * peut confronter chaque valeur à sa preuve.
 */
export interface ProviderApiProbe {
  /** URL exacte sondée, sans jeton. */
  readonly probedUrl: string;
  /** Code HTTP obtenu sur `probedUrl`, sans jeton. */
  readonly probedStatus: number;
  /**
   * Code HTTP obtenu sur un chemin volontairement inexistant du même hôte.
   * `404` → le serveur route avant d'authentifier, `probedStatus` prouve le chemin.
   * `401` → il authentifie avant de router, `probedStatus` ne prouve rien.
   */
  readonly unknownPathStatus: number;
  /** Date de la sonde (ISO). */
  readonly probedOn: string;
  /**
   * `false` = chemin NON PROUVÉ, à confirmer par BACK-3 au premier appel avec une clé
   * réelle avant d'annoncer le provider comme supporté. Voir DeepSeek.
   */
  readonly endpointProven: boolean;
}

/**
 * Une entrée par provider.
 *
 * `apiBaseUrl` / `testEndpoint` / `buildTestRequest` sont la forme demandée par le ticket
 * (ligne 69). Les deux champs suivants relèvent du « ou équivalent » de la même ligne et
 * sont justifiés par les critères d'acceptation de BACK-3, pas par du confort :
 *
 * - `invalidKeyStatuses` : BACK-3 doit distinguer « clé invalide » de « quota dépassé » et
 *   de « provider indisponible » (ligne 158), et afficher « jeton invalide ou expiré »
 *   (ligne 162). La sonde du 31/08/2026 a montré que le code HTTP d'une clé refusée
 *   N'EST PAS uniforme : `401` chez Anthropic, OpenAI, DeepSeek et Kimi, mais `400` chez
 *   Grok et Gemini. Un dispatch qui supposerait « 401 ⇒ clé invalide, 400 ⇒ bug interne »
 *   afficherait un message faux pour deux providers sur six. Cette table porte donc le
 *   fait observé, à la place de la supposition.
 * - `probe` : la preuve datée de `apiBaseUrl` + `testEndpoint`, et le signal
 *   `endpointProven` qui empêche de faire passer un chemin non prouvé pour vérifié.
 */
export interface ProviderApiEntry {
  readonly apiBaseUrl: string;
  /** Chemin de VÉRIFICATION, en lecture seule et sans coût de génération (BACK-3, ligne 163). */
  readonly testEndpoint: string;
  /**
   * Construit la requête de test pour cette clé. Fonction pure : n'exécute rien,
   * ne journalise rien, ne formate aucun message. La clé n'est lue que pour être posée
   * dans un en-tête.
   */
  readonly buildTestRequest: (apiKey: string) => ProviderTestRequest;
  /**
   * Codes HTTP observés le 31/08/2026 pour une clé refusée. À traiter par BACK-3 comme
   * `invalid_token` (`AiTestConnectionErrorCode` d'ARCHI-2).
   */
  readonly invalidKeyStatuses: readonly number[];
  readonly probe: ProviderApiProbe;
}

/* -------------------------------------------------------------------------- */
/* Table                                                                      */
/* -------------------------------------------------------------------------- */

/** Date unique des sondes de ce fichier. */
const PROBED_ON = "2026-08-31";

/**
 * `Record<ProviderId, ProviderApiEntry>` avec ANNOTATION explicite (et non `satisfies`
 * seul) : c'est ce qui réalise le critère d'acceptation ligne 74. Ajouter un 7ᵉ membre à
 * `ProviderId` sans l'ajouter ici casse la compilation (`TS2741 : Property '…' is
 * missing`), et une clé en trop la casse aussi (`TS2353 : Object literal may only specify
 * known properties`). Vérifié par sonde jetable hors dépôt le 31/08/2026.
 *
 * L'ordre suit la liste produit (ligne 12) : Anthropic, OpenAI, DeepSeek, Kimi, Grok,
 * Gemini.
 */
export const PROVIDERS_API: Record<ProviderId, ProviderApiEntry> = {
  /**
   * VÉRIFIÉ le 31/08/2026
   *   GET https://api.anthropic.com/v1/models                → 401
   *   GET https://api.anthropic.com/v1/zzz-does-not-exist    → 404  (le chemin est donc prouvé)
   * Corps du 401 sans jeton : `{"error":{"type":"authentication_error",
   * "message":"x-api-key header is required"}}` — le serveur NOMME lui-même son en-tête
   * d'authentification, c'est la confirmation la plus directe obtenue des six.
   * Clé refusée (chaîne de remplissage) → 401 « invalid x-api-key ».
   *
   * À CONFIRMER PAR BACK-3 — l'en-tête `anthropic-version` ci-dessous. Sa NÉCESSITÉ et sa
   * VALEUR n'ont pas pu être vérifiées : l'authentification est évaluée avant lui, et les
   * requêtes avec et sans cet en-tête renvoient le même « invalid x-api-key » (sondes du
   * 31/08/2026). La valeur `2023-06-01` est donc la seule de ce fichier qui ne repose pas
   * sur une observation. Elle est conservée parce qu'un en-tête superflu est inoffensif
   * alors qu'un en-tête obligatoire manquant casserait l'appel — mais elle doit être
   * confirmée au premier test avec une clé réelle.
   */
  anthropic: {
    apiBaseUrl: "https://api.anthropic.com",
    testEndpoint: "/v1/models",
    buildTestRequest: (apiKey) => ({
      url: "https://api.anthropic.com/v1/models",
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    }),
    invalidKeyStatuses: [401],
    probe: {
      probedUrl: "https://api.anthropic.com/v1/models",
      probedStatus: 401,
      unknownPathStatus: 404,
      probedOn: PROBED_ON,
      endpointProven: true,
    },
  },

  /**
   * VÉRIFIÉ le 31/08/2026
   *   GET https://api.openai.com/v1/models                 → 401
   *   GET https://api.openai.com/v1/zzz-does-not-exist     → 404  (chemin prouvé)
   * Le 401 sans jeton porte `www-authenticate: Bearer realm="OpenAI API"` : le schéma
   * `Bearer` est annoncé par le serveur lui-même (RFC 7235), pas supposé. Corps :
   * « Missing bearer authentication in header ».
   * Clé refusée → 401, `code: "invalid_api_key"`.
   *
   * LIMITE DÉCOUVERTE, à relayer à BACK-3 : le corps d'erreur d'OpenAI RECOPIE un
   * fragment de la clé envoyée (« Incorrect API key provided: not-a-ke************0831 »).
   * Le message du provider ne doit donc jamais être journalisé ni réémis tel quel vers le
   * front — BACK-3 rédige son propre message (obligation du §Jetons de
   * `docs/api-contracts.md`).
   */
  openai: {
    apiBaseUrl: "https://api.openai.com",
    testEndpoint: "/v1/models",
    buildTestRequest: (apiKey) => ({
      url: "https://api.openai.com/v1/models",
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }),
    invalidKeyStatuses: [401],
    probe: {
      probedUrl: "https://api.openai.com/v1/models",
      probedStatus: 401,
      unknownPathStatus: 404,
      probedOn: PROBED_ON,
      endpointProven: true,
    },
  },

  /**
   * ⚠ CHEMIN NON PROUVÉ — le seul des six. `endpointProven: false`.
   *
   * Sondes du 31/08/2026 :
   *   GET https://api.deepseek.com/models                 → 401
   *   GET https://api.deepseek.com/v1/models              → 401
   *   GET https://api.deepseek.com/zzz-does-not-exist     → 401  ← sonde de contrôle
   *   GET https://api.deepseek.com/v1/zzz-does-not-exist  → 401
   * Un chemin volontairement inexistant renvoie le MÊME 401 que le chemin candidat : la
   * passerelle DeepSeek (corps « Authentication Fails (governor) ») authentifie avant de
   * router. Le 401 ne prouve donc rien sur l'existence du chemin, contrairement aux cinq
   * autres providers. Ont aussi été tentés, sans pouvoir discriminer : `OPTIONS`
   * (200 sur chemin valide comme sur chemin bidon), `HEAD` (401/401), `POST` (401/401),
   * et une requête portant l'en-tête d'authentification (même erreur sur les deux
   * chemins). Aucune sonde sans clé ne permet de conclure.
   *
   * Ce qui EST vérifié : l'hôte `api.deepseek.com` existe, répond en TLS et exige une
   * authentification ; le canal d'authentification est `Authorization: Bearer` (l'envoi de
   * cet en-tête fait passer le corps de « Authentication Fails (governor) » à
   * « Authentication Fails, Your api key: … is invalid », donc le serveur le lit) ; une
   * clé refusée renvoie 401.
   *
   * Ce qui N'EST PAS vérifié : que `/models` soit le bon chemin — `/v1/models` reste un
   * candidat exactement aussi plausible, aucune des deux valeurs n'a de preuve.
   * Conformément à la règle de non-invention, ce chemin est signalé comme candidat et
   * NON comme vérifié. BACK-3 doit le confirmer avec une clé réelle avant d'annoncer
   * DeepSeek comme supporté ; un 401 sur ce provider peut signifier « clé invalide » ou
   * « chemin faux », et rien ne les distingue depuis l'extérieur.
   *
   * LIMITE DÉCOUVERTE : comme OpenAI, DeepSeek recopie un fragment de la clé dans son
   * message d'erreur (« Your api key: ****0831 is invalid »). Ne jamais journaliser ni
   * réémettre ce corps.
   */
  deepseek: {
    apiBaseUrl: "https://api.deepseek.com",
    testEndpoint: "/models",
    buildTestRequest: (apiKey) => ({
      url: "https://api.deepseek.com/models",
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }),
    invalidKeyStatuses: [401],
    probe: {
      probedUrl: "https://api.deepseek.com/models",
      probedStatus: 401,
      unknownPathStatus: 401,
      probedOn: PROBED_ON,
      endpointProven: false,
    },
  },

  /**
   * VÉRIFIÉ le 31/08/2026 — Kimi (Moonshot AI)
   *   GET https://api.moonshot.ai/v1/models                → 401
   *   GET https://api.moonshot.ai/v1/zzz-does-not-exist    → 404  (chemin prouvé)
   * Corps du 401 sans jeton : « Incorrect API key provided ». Le canal
   * `Authorization: Bearer` est confirmé par changement d'erreur à l'envoi de l'en-tête
   * (« Invalid Authentication »). Clé refusée → 401.
   *
   * LIMITE DÉCOUVERTE : il existe DEUX hôtes distincts, tous deux vérifiés le même jour —
   * `api.moonshot.ai` (401, chemin bidon 404) et `api.moonshot.cn` (401, chemin bidon
   * 404). L'hôte global `.ai` est retenu ici. Une clé émise sur la plateforme chinoise
   * n'est pas nécessairement valable sur l'hôte global : si un utilisateur voit sa clé
   * Kimi refusée alors qu'elle fonctionne ailleurs, c'est le premier point à examiner.
   * Le choix d'hôte n'est pas configurable en v1 (aucun ticket ne le prévoit).
   */
  kimi: {
    apiBaseUrl: "https://api.moonshot.ai",
    testEndpoint: "/v1/models",
    buildTestRequest: (apiKey) => ({
      url: "https://api.moonshot.ai/v1/models",
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }),
    invalidKeyStatuses: [401],
    probe: {
      probedUrl: "https://api.moonshot.ai/v1/models",
      probedStatus: 401,
      unknownPathStatus: 404,
      probedOn: PROBED_ON,
      endpointProven: true,
    },
  },

  /**
   * VÉRIFIÉ le 31/08/2026 — Grok (xAI)
   *   GET https://api.x.ai/v1/models                → 401
   *   GET https://api.x.ai/v1/zzz-does-not-exist    → 404  (chemin prouvé)
   * Corps du 401 sans jeton : `{"code":"unauthenticated:no-credentials"}`. Le canal
   * `Authorization: Bearer` est confirmé par changement d'erreur à l'envoi de l'en-tête.
   *
   * LIMITE DÉCOUVERTE, importante pour BACK-3 : une clé refusée renvoie **400**, pas 401
   * (`{"code":"invalid-argument","error":"Incorrect API key provided…"}`). Le 401 est
   * réservé à l'ABSENCE de credentials. D'où `invalidKeyStatuses: [400, 401]` : les deux
   * doivent produire « jeton invalide ou expiré » (BACK-3, ligne 162), sans quoi le seul
   * cas réel — une clé fausse collée par l'utilisateur — tomberait dans la branche
   * « erreur inattendue ».
   *
   * `https://api.x.ai/v1/api-key` répond également 401 sans jeton et serait une route de
   * vérification encore plus légère, mais `/v1/models` est retenu : c'est la même forme
   * que les cinq autres providers, donc un seul schéma de lecture pour BACK-3.
   */
  grok: {
    apiBaseUrl: "https://api.x.ai",
    testEndpoint: "/v1/models",
    buildTestRequest: (apiKey) => ({
      url: "https://api.x.ai/v1/models",
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }),
    invalidKeyStatuses: [400, 401],
    probe: {
      probedUrl: "https://api.x.ai/v1/models",
      probedStatus: 401,
      unknownPathStatus: 404,
      probedOn: PROBED_ON,
      endpointProven: true,
    },
  },

  /**
   * VÉRIFIÉ le 31/08/2026 — Gemini (Google AI / Generative Language API)
   *   GET https://generativelanguage.googleapis.com/v1beta/models             → 403
   *   GET https://generativelanguage.googleapis.com/v1beta/zzz-does-not-exist → 404  (chemin prouvé)
   * Le 403 sans jeton (« Method doesn't allow unregistered callers ») ne nomme aucun
   * en-tête. Le canal `x-goog-api-key` a donc été confirmé par le comportement : envoyer
   * cet en-tête fait passer la réponse de 403 PERMISSION_DENIED à 400
   * `API_KEY_INVALID` — le serveur lit bien ce canal et y cherche une clé.
   *
   * POURQUOI L'EN-TÊTE ET PAS `?key=` : le paramètre de requête est l'autre canal
   * documenté par Google, et la sonde `…/v1beta/models?key=` renvoie encore le 403
   * « unregistered callers ». Il est écarté délibérément : une clé placée dans une URL
   * se retrouve dans les journaux d'accès, les traces et les rapports d'erreur
   * (§Jetons de `docs/api-contracts.md`). L'en-tête étant confirmé comme fonctionnel,
   * il n'y a aucune raison d'exposer la clé dans l'URL.
   *
   * LIMITE DÉCOUVERTE : comme Grok, une clé refusée renvoie **400** et non 401/403 ; le
   * 403 signale l'absence totale d'identité. `invalidKeyStatuses: [400, 403]`.
   */
  gemini: {
    apiBaseUrl: "https://generativelanguage.googleapis.com",
    testEndpoint: "/v1beta/models",
    buildTestRequest: (apiKey) => ({
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
      },
    }),
    invalidKeyStatuses: [400, 403],
    probe: {
      probedUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      probedStatus: 403,
      unknownPathStatus: 404,
      probedOn: PROBED_ON,
      endpointProven: true,
    },
  },
};

/**
 * Accès à une entrée. Le paramètre étant typé `ProviderId`, l'indexation ne peut pas
 * échouer : pas de retour `undefined` à défendre côté BACK-3. La validation du corps de
 * requête venant du réseau reste à la frontière (ARCHI-2, « valider les corps de requête
 * à la frontière ») — c'est là qu'une chaîne inconnue doit être rejetée, pas ici.
 */
export function getProviderApi(provider: ProviderId): ProviderApiEntry {
  return PROVIDERS_API[provider];
}
