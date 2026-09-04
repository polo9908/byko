/**
 * BACK-1 — Test de connexion Jira, à la volée.
 *
 * Module SERVEUR uniquement : il reçoit un jeton en clair. Il ne doit jamais être importé
 * depuis un composant client. Aucune persistance ici (BACK-4 s'en charge), aucun effet de
 * bord disque, aucune écriture de log.
 *
 * Il n'expose qu'une fonction, `testJiraConnection`, qui traduit une tentative d'appel à
 * `GET {instanceUrl}/rest/api/3/myself` en `JiraTestConnectionResponse` (ARCHI-2).
 * Le branchement HTTP (`POST /api/settings/test-connection`) est une étape séparée : cette
 * fonction est testable seule, sans Next.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODE D'AUTHENTIFICATION — tranché le 04/09/2026
 * ─────────────────────────────────────────────────────────────────────────────
 * Ce fichier envoie `Authorization: Basic base64(email:jeton)`, conformément au mode
 * documenté par Atlassian pour un jeton API **Jira Cloud** (`/rest/api/3/...`, la cible
 * ici). Le `Bearer <jeton>` seul, essayé dans une version antérieure de ce fichier, est
 * réservé aux jetons d'accès **OAuth 2.0 (3LO)** ou aux **Personal Access Tokens de Jira
 * Data Center/Server** (`/rest/api/2/`) — pas au jeton API Cloud classique que l'utilisateur
 * colle dans le champ. `JiraCredentials` (ARCHI-2) porte donc `email` en plus de
 * `instanceUrl`/`apiToken` depuis cette date. Voir `docs/api-contracts.md`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SONDE RÉELLE DU 04/09/2026 — sans jeton, sur une instance Jira Cloud publique
 * ─────────────────────────────────────────────────────────────────────────────
 * Méthode reprise de `lib/providers-api.ts` : rien n'est écrit ici de mémoire, chaque
 * valeur est accompagnée de la commande qui l'a produite. Hôte sondé :
 * `ecosystem.atlassian.net` (instance Cloud publique d'Atlassian, aucun compte engagé).
 *
 *   curl -o /dev/null -w '%{http_code}' https://ecosystem.atlassian.net/rest/api/3/myself
 *     → 401, en-tête `www-authenticate: OAuth realm="…"`.
 *   curl … https://ecosystem.atlassian.net/rest/api/3/chemin-volontairement-faux
 *     → 404.  ← sonde de contrôle : le serveur ROUTE avant d'authentifier, donc le 401
 *       ci-dessus prouve bien que `/rest/api/3/myself` existe sur cet hôte.
 *   curl -H 'Authorization: Bearer NOT_A_REAL_TOKEN' …/myself
 *     → 403, sans corps exploitable. (Mode abandonné, conservé ici comme trace.)
 *   curl -u 'nobody@example.com:NOT_A_REAL_TOKEN' …/myself
 *     → 401, en-tête `x-seraph-loginreason: AUTHENTICATED_FAILED`. C'est le mode Basic
 *       retenu : un couple email/jeton refusé ressort en 401, comportement standard.
 *
 * Ce que la sonde ne dit PAS : elle ne valide aucun chemin de succès. Aucun `200` de
 * `/myself` n'a été observé, donc la présence et la forme de `displayName` restent une
 * lecture de la documentation Atlassian, non une observation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANTS DE SÉCURITÉ tenus par ce fichier
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Le jeton ne circule que dans l'en-tête `Authorization` de l'unique requête émise.
 *    Jamais dans une URL, un message, une exception relancée, une valeur de retour.
 * 2. Aucun `console.*` ici, même en débogage : ce module ne journalise rien du tout.
 * 3. Aucun message d'erreur ne recopie une entrée utilisateur non validée. En particulier
 *    l'URL saisie n'est JAMAIS citée telle quelle : seul le `hostname` d'une URL déjà
 *    reconnue comme `https://` valide peut apparaître, et seulement s'il ressemble à un
 *    nom de domaine (`citableHost`, au moins un point) — un utilisateur qui colle son
 *    jeton dans le champ URL par erreur produit un `hostname` à un seul segment, remplacé
 *    par un libellé générique. Motif : ces messages sont persistés par BACK-4 dans
 *    `lastError.message` puis relus par `GET /api/settings` (`docs/api-contracts.md`,
 *    §Risque résiduel) ; ce jeton mal placé ne doit pas se retrouver écrit durablement sur
 *    disque.
 * 4. Aucun fragment du corps de réponse Jira n'est recopié dans un message : ce corps peut
 *    contenir l'adresse e-mail du compte ou un message d'erreur d'un proxy d'entreprise.
 *    Seul `displayName`, en cas de succès, ressort — c'est ce que le contrat demande.
 * 5. Les redirections ne sont pas suivies (`redirect: "manual"`) : suivre un `3xx` risque
 *    de rejouer l'en-tête `Authorization` vers un hôte que l'utilisateur n'a pas saisi.
 * 6. Seul `https://` est accepté : une valeur en Basic auth sur `http://` voyage en clair
 *    sur le réseau (`base64` est un encodage, pas un chiffrement).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS VÉRIFIÉ
 * ─────────────────────────────────────────────────────────────────────────────
 * La sonde ci-dessus établit l'existence du chemin, le 401 sans jeton et le 403 sur
 * `Bearer` invalide. Tout le reste demeure non observé, faute de jeton valide :
 * - aucun chemin de succès (`200` + `displayName`) n'a été vu ;
 * - ni le code HTTP d'un jeton révoqué après usage, ni celui d'une organisation qui
 *   interdit les jetons personnels ;
 * - ni la forme d'un `429` Jira, ni la présence effective d'un `Retry-After`.
 * Ces branches sont écrites d'après la documentation Atlassian. À confronter à une instance
 * réelle avant de considérer BACK-1 comme validé.
 */

import type {
  JiraAccountInfo,
  JiraCredentials,
  JiraTestConnectionErrorCode,
  JiraTestConnectionResponse,
} from "@/lib/types/settings";

/* -------------------------------------------------------------------------- */
/* Constantes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Délai maximal de l'appel, corps de réponse compris. Le test est déclenché au blur du
 * champ (règle produit, ligne 10) : au-delà d'une dizaine de secondes l'utilisateur a déjà
 * conclu que l'écran est figé. Une valeur plus généreuse ne rendrait pas un jeton valide.
 */
export const JIRA_TEST_TIMEOUT_MS = 10_000;

/** Chemin de vérification le moins coûteux : lecture seule, sans paramètre. */
const MYSELF_PATH = "/rest/api/3/myself";

/**
 * Plafond de lecture du corps. Une URL saisie par l'utilisateur peut pointer vers
 * n'importe quoi, y compris une réponse énorme ; `/myself` tient dans quelques kilooctets.
 */
const MAX_BODY_BYTES = 512 * 1024;

/* -------------------------------------------------------------------------- */
/* Constructeurs de réponse                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Construit l'échec champ par champ. Aucun spread, aucune réutilisation d'un objet
 * contenant des credentials : c'est la charge explicitement laissée à BACK-1 par l'en-tête
 * de `lib/types/settings.ts` (« construire chaque réponse champ par champ »).
 *
 * `code` est omis — et non mis à `undefined` — quand aucun des quatre codes du contrat ne
 * décrit honnêtement la cause. Le contrat le prévoit : « un `code` obligatoire forcerait
 * une implémentation à ranger un échec imprévu dans une catégorie fausse ».
 */
function failure(
  message: string,
  code?: JiraTestConnectionErrorCode,
): JiraTestConnectionResponse {
  if (code === undefined) {
    return { block: "jira", status: "error", message };
  }
  return { block: "jira", status: "error", message, code };
}

/** Construit le succès champ par champ, à partir de la seule valeur à exposer. */
function success(accountName: string): JiraTestConnectionResponse {
  const account: JiraAccountInfo = { accountName };
  return { block: "jira", status: "success", account };
}

/* -------------------------------------------------------------------------- */
/* Validation de l'URL d'instance                                             */
/* -------------------------------------------------------------------------- */

type UrlCheck =
  | { valid: true; endpoint: URL; host: string }
  | { valid: false; message: string };

/**
 * Valide `instanceUrl` et en dérive l'URL de `/myself`, sans aucun appel réseau.
 *
 * Toute sortie en échec porte `invalid_url` côté appelant : une URL malformée n'est jamais
 * un problème de jeton (critère d'acceptation BACK-1 : « message d'erreur distinct de
 * "URL introuvable" »).
 *
 * Aucun message produit ici ne cite l'entrée : voir invariant 3 de l'en-tête.
 *
 * NON TRANCHÉ, hérité de `docs/api-contracts.md` (§« la forme d'`instanceUrl` ») : ce
 * module REFUSE une adresse sans schéma (`mon-entreprise.atlassian.net`). C'est le choix
 * strict, et il est délibéré : accepter ici une forme que `new URL()` rejettera ensuite
 * chez FRONT-5 ferait passer le test au vert pour une valeur inexploitable en aval. Si le
 * produit préfère la tolérance, la normalisation doit être décidée en un seul endroit,
 * avec BACK-4 (forme persistée) et FRONT-5 (dérivation du nom d'hôte).
 */
function checkInstanceUrl(rawInstanceUrl: string): UrlCheck {
  const trimmed = rawInstanceUrl.trim();

  if (trimmed === "") {
    return {
      valid: false,
      message:
        "Renseigne l'URL de ton instance Jira, par exemple https://mon-entreprise.atlassian.net.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      message:
        "L'adresse saisie n'est pas une URL valide. Indique l'URL complète de ton instance, schéma compris, par exemple https://mon-entreprise.atlassian.net.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      message:
        "Seules les adresses en https:// sont acceptées : sur une connexion non chiffrée, ton jeton circulerait en clair. Corrige le schéma de l'URL.",
    };
  }

  // Un `https://utilisateur:motdepasse@hote` enverrait des identifiants dans l'URL, donc
  // potentiellement dans des journaux d'accès. Refus net plutôt que nettoyage silencieux.
  if (parsed.username !== "" || parsed.password !== "") {
    return {
      valid: false,
      message:
        "L'URL ne doit pas contenir d'identifiants (la partie « utilisateur:mot-de-passe@ »). Saisis uniquement l'adresse de l'instance, par exemple https://mon-entreprise.atlassian.net.",
    };
  }

  if (parsed.hostname === "") {
    return {
      valid: false,
      message:
        "L'URL saisie ne contient pas de nom de domaine. Indique l'adresse de ton instance, par exemple https://mon-entreprise.atlassian.net.",
    };
  }

  // Le chemin éventuel est conservé (une instance peut être servie sous un préfixe), mais
  // la requête et le fragment sont écartés : ils n'ont aucun sens sur `/myself` et un
  // paramètre inattendu recopié dans une URL sortante est un risque inutile.
  const basePath = parsed.pathname.replace(/\/+$/, "");
  const endpoint = new URL(`${basePath}${MYSELF_PATH}`, parsed.origin);

  return { valid: true, endpoint, host: parsed.host };
}

/* -------------------------------------------------------------------------- */
/* Validation et transport du jeton                                           */
/* -------------------------------------------------------------------------- */

/**
 * Un jeton collé depuis un gestionnaire de mots de passe traîne souvent un retour à la
 * ligne ou une espace insécable. Sans ce contrôle, `fetch` lèverait un `TypeError` sur
 * l'en-tête invalide, que la classification réseau rangerait à tort dans
 * « instance injoignable » — l'utilisateur chercherait alors un problème qui n'existe pas.
 *
 * Le jeton n'est évidemment jamais recopié dans le message.
 */
function checkApiToken(rawApiToken: string): { valid: true; token: string } | { valid: false; message: string } {
  const trimmed = rawApiToken.trim();

  if (trimmed === "") {
    return {
      valid: false,
      message: "Colle ton jeton API Jira pour que la connexion puisse être testée.",
    };
  }

  // Caractères ASCII imprimables uniquement : tout le reste est irrecevable comme valeur
  // d'en-tête HTTP.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    return {
      valid: false,
      message:
        "Le jeton contient des caractères inattendus (retour à la ligne, espace ou caractère accentué). Recopie-le depuis ton compte Atlassian, sans rien autour.",
    };
  }

  return { valid: true, token: trimmed };
}

/**
 * Un email vide ou manifestement mal formé est rejeté avant l'appel réseau, pour la même
 * raison que `checkApiToken` : mieux vaut un message précis que de laisser `fetch` échouer
 * sur un en-tête `Authorization` invalide, ce qui serait classé à tort en
 * `instance_unreachable`.
 */
function checkEmail(rawEmail: string): { valid: true; email: string } | { valid: false; message: string } {
  const trimmed = rawEmail.trim();

  if (trimmed === "") {
    return {
      valid: false,
      message: "Renseigne l'adresse e-mail associée à ton compte Atlassian.",
    };
  }

  // Contrôle volontairement minimal (présence d'un `@` avec du texte de part et d'autre) :
  // la validation stricte d'une adresse e-mail n'a pas sa place ici, seul Jira fait foi.
  if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
    return {
      valid: false,
      message: "L'adresse e-mail saisie n'est pas valide.",
    };
  }

  return { valid: true, email: trimmed };
}

/**
 * Seul endroit du projet où le jeton Jira est mis en forme pour le réseau.
 * Basic auth `base64(email:jeton)` — mode retenu le 04/09/2026, voir l'en-tête du fichier.
 */
function buildAuthorizationHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, "utf-8").toString("base64")}`;
}

/* -------------------------------------------------------------------------- */
/* Lecture bornée du corps de réponse                                         */
/* -------------------------------------------------------------------------- */

/** Lit au plus `MAX_BODY_BYTES` octets, puis abandonne. `null` = illisible ou trop gros. */
async function readBodyText(response: Response): Promise<string | null> {
  const body = response.body;
  if (body === null) {
    return null;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8").decode(merged);
}

/**
 * Extrait le `displayName` de `/myself`. Rien d'autre n'est lu : le corps contient aussi
 * `emailAddress`, qui n'a pas à ressortir de ce module (invariant 4).
 */
function extractDisplayName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const candidate = (payload as { displayName?: unknown }).displayName;
  if (typeof candidate !== "string") {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed === "" ? null : trimmed;
}

/* -------------------------------------------------------------------------- */
/* Classification des échecs                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Récupère le code d'erreur système d'un échec `fetch` (`ENOTFOUND`, `ECONNREFUSED`…).
 * Node l'expose sur `cause`, parfois imbriqué d'un niveau supplémentaire.
 */
function extractSystemErrorCode(error: unknown, depth = 0): string | null {
  if (typeof error !== "object" || error === null || depth > 3) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code !== "") {
    return code;
  }
  return extractSystemErrorCode((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * `host` vient de `new URL(instanceUrl).host`, donc peut être n'importe quoi qu'un
 * utilisateur ait tapé après `https://` — y compris un jeton collé par erreur dans le champ
 * URL (invariant 3 de l'en-tête : « l'URL saisie n'est JAMAIS citée telle quelle »). Un nom
 * de domaine légitime comporte au moins un point ; un jeton généralement pas. Ce n'est pas
 * une preuve, seulement un filtre bon marché : au moindre doute, ne pas citer.
 */
const DOMAIN_LIKE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:\d+)?$/i;

function citableHost(host: string): string {
  return DOMAIN_LIKE.test(host) ? host : "l'adresse saisie";
}

/**
 * Traduit un échec de transport en message. Tous ces cas portent `instance_unreachable` :
 * la requête n'a jamais atteint une application Jira, donc rien ne permet de dire quoi que
 * ce soit du jeton (et surtout pas qu'il est invalide).
 */
function describeNetworkFailure(error: unknown, host: string): string {
  const code = extractSystemErrorCode(error);

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Le domaine ${host} est introuvable. Vérifie l'orthographe de l'URL de ton instance, puis la résolution DNS de ce poste.`;
    case "ECONNREFUSED":
      return `La connexion à ${host} a été refusée. L'instance est peut-être arrêtée, ou l'accès est filtré depuis ce réseau (VPN, pare-feu d'entreprise).`;
    case "ECONNRESET":
    case "EPIPE":
      return `La connexion à ${host} a été interrompue avant la réponse. Retente dans un instant ; si cela persiste, vérifie le proxy ou le VPN de ce poste.`;
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `${host} n'est pas joignable depuis ce réseau. Vérifie ta connexion, ou l'accès à l'instance derrière un VPN.`;
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `Le certificat HTTPS de ${host} n'a pas pu être validé. La connexion a été abandonnée sans envoyer le jeton ; vérifie l'URL de l'instance.`;
    default:
      return `Impossible de joindre ${host}. Vérifie ta connexion réseau et l'URL de ton instance Jira.`;
  }
}

/** `Retry-After` en secondes. Le format date HTTP n'est pas interprété (rare, et optionnel). */
function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  const seconds = Number.parseInt(header.trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 ? seconds : null;
}

/**
 * Nom d'hôte d'une redirection, à des fins d'explication. Valeur venant du serveur, pas de
 * l'utilisateur : elle peut être citée sans risquer de recopier une saisie sensible.
 */
function redirectTargetHost(location: string | null, base: URL): string | null {
  if (location === null || location.trim() === "") {
    return null;
  }
  try {
    return new URL(location, base).host;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Point d'entrée                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Teste une connexion Jira sans rien persister.
 *
 * Ne lève jamais : tout échec — y compris une entrée aberrante — ressort en
 * `{ status: "error", message }`, parce que l'appelant est une route HTTP dont le crash
 * serait un `500` sans explication (critère d'acceptation BACK-1 : « pas de crash serveur »).
 *
 * Ce que la fonction sait distinguer, et ce qu'elle ne sait pas :
 * - `invalid_url` : URL malformée, schéma non-https, identifiants dans l'URL, ou hôte qui
 *   répond `404` sur l'API — l'adresse ne désigne pas une API Jira Cloud.
 * - `invalid_token` : `401` et `403`, plus les jetons ou l'email vides ou intransportables.
 * - `instance_unreachable` : DNS, connexion refusée, TLS invalide, et `5xx`.
 * - `timeout` : dépassement de `JIRA_TEST_TIMEOUT_MS`.
 * - sans `code` : `429`, `3xx` non suivie, statut inattendu, et le cas le plus traître —
 *   un `200` dont le corps n'a pas la forme d'un utilisateur Jira. Ce dernier n'est PAS
 *   un succès : un proxy d'authentification d'entreprise renvoie couramment `200` avec une
 *   page de login. Le faire passer pour un succès donnerait un `accountName` vide.
 */
export async function testJiraConnection(
  credentials: JiraCredentials,
): Promise<JiraTestConnectionResponse> {
  // `credentials` est typé par `JiraCredentials`, mais un corps de requête HTTP mal formé
  // n'est pas garanti par le typage (invariant documenté en tête de
  // `lib/types/settings.ts`) : `credentials` lui-même absent, ou un champ absent, ferait
  // lever un `TypeError` sur `.trim()` plus bas, contredisant la garantie « ne lève
  // jamais » de cette fonction. D'où le contrôle de `credentials` avant celui de ses champs.
  if (
    typeof credentials !== "object" ||
    credentials === null ||
    typeof credentials.instanceUrl !== "string" ||
    typeof credentials.email !== "string" ||
    typeof credentials.apiToken !== "string"
  ) {
    return failure(
      "La requête de test de connexion Jira est incomplète ou mal formée.",
    );
  }

  const urlCheck = checkInstanceUrl(credentials.instanceUrl);
  if (!urlCheck.valid) {
    return failure(urlCheck.message, "invalid_url");
  }

  const emailCheck = checkEmail(credentials.email);
  if (!emailCheck.valid) {
    return failure(emailCheck.message, "invalid_token");
  }

  const tokenCheck = checkApiToken(credentials.apiToken);
  if (!tokenCheck.valid) {
    return failure(tokenCheck.message, "invalid_token");
  }

  const { endpoint, host: rawHost } = urlCheck;
  // Filtré avant tout usage dans un message : voir `citableHost`.
  const host = citableHost(rawHost);
  // Conservé pour distinguer un abandon par délai d'un échec de transport : selon la
  // version de Node, l'erreur relayée par `fetch` est un `TimeoutError` ou un `AbortError`.
  const timeoutSignal = AbortSignal.timeout(JIRA_TEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        // Unique endroit où le jeton quitte ce module.
        Authorization: buildAuthorizationHeader(emailCheck.email, tokenCheck.token),
        Accept: "application/json",
      },
      redirect: "manual",
      cache: "no-store",
      signal: timeoutSignal,
    });
  } catch (error: unknown) {
    if (timeoutSignal.aborted) {
      return failure(
        `${host} n'a pas répondu en moins de ${Math.round(JIRA_TEST_TIMEOUT_MS / 1000)} secondes. L'instance est peut-être surchargée ou inaccessible depuis ce réseau : retente dans un instant.`,
        "timeout",
      );
    }
    return failure(describeNetworkFailure(error, host), "instance_unreachable");
  }

  const status = response.status;

  // Sonde du 04/09/2026 (voir en-tête) : en Basic auth, un couple email/jeton refusé
  // ressort en 401 — c'est le cas nominal du jeton invalide dans ce mode.
  if (status === 401) {
    return failure(
      `${host} a refusé l'authentification (HTTP 401). Vérifie que l'adresse e-mail et le jeton sont corrects et correspondent au même compte, et que le jeton n'a pas expiré ; au moindre doute, régénère-le depuis la page « API tokens » de ton compte Atlassian.`,
      "invalid_token",
    );
  }

  if (status === 403) {
    return failure(
      `${host} a reçu l'authentification mais refuse l'accès (HTTP 403). Le compte n'a probablement pas les droits sur cette instance, ou l'organisation restreint l'usage des jetons personnels : vérifie auprès de l'administrateur Jira.`,
      "invalid_token",
    );
  }

  if (status === 404) {
    return failure(
      `${host} répond, mais l'API Jira n'y est pas trouvée (HTTP 404). Saisis l'URL racine de l'instance (par exemple https://mon-entreprise.atlassian.net), sans chemin ni lien vers un ticket.`,
      "invalid_url",
    );
  }

  if (status === 429) {
    const retryAfter = parseRetryAfterSeconds(response.headers.get("retry-after"));
    const delay =
      retryAfter === null
        ? "Attends une minute avant de retester."
        : `Attends environ ${retryAfter} secondes avant de retester.`;
    // Aucun des quatre codes du contrat ne décrit un rate-limit : le `code` est omis
    // plutôt que faussé (le contrat le prévoit explicitement).
    return failure(
      `${host} a temporairement limité le nombre de requêtes (HTTP 429). ${delay}`,
    );
  }

  if (status >= 500) {
    return failure(
      `${host} a répondu par une erreur serveur (HTTP ${status}). L'instance est probablement indisponible ou en maintenance : retente dans quelques minutes.`,
      "instance_unreachable",
    );
  }

  if (status >= 300 && status < 400) {
    const target = redirectTargetHost(response.headers.get("location"), endpoint);
    const where = target === null ? "" : ` vers ${target}`;
    // La redirection n'est volontairement pas suivie : rejouer l'en-tête d'authentification
    // vers un hôte non saisi par l'utilisateur exposerait le jeton (invariant 5).
    return failure(
      `${host} redirige la requête${where} (HTTP ${status}). Le jeton n'est pas envoyé à une autre adresse que celle que tu as saisie : indique directement l'URL finale de ton instance.`,
    );
  }

  if (status !== 200) {
    return failure(
      `${host} a répondu avec un statut inattendu (HTTP ${status}). Vérifie que cette adresse est bien celle d'une instance Jira Cloud.`,
    );
  }

  let rawBody: string | null;
  try {
    rawBody = await readBodyText(response);
  } catch (error: unknown) {
    if (timeoutSignal.aborted) {
      return failure(
        `${host} a commencé à répondre mais n'a pas terminé en moins de ${Math.round(JIRA_TEST_TIMEOUT_MS / 1000)} secondes. Retente dans un instant.`,
        "timeout",
      );
    }
    return failure(describeNetworkFailure(error, host), "instance_unreachable");
  }

  // À partir d'ici : la réponse est un 200 lisible. Un 200 dont le contenu n'est pas un
  // utilisateur Jira n'est pas un succès — c'est une indétermination, et elle est
  // remontée comme telle, avec sa cause probable.
  const unusable = `${host} a répondu (HTTP 200), mais sa réponse n'a pas la forme attendue de l'API Jira. L'adresse pointe peut-être vers un autre service, ou un portail d'authentification s'est interposé (proxy ou VPN d'entreprise).`;

  if (rawBody === null || rawBody.trim() === "") {
    return failure(unusable);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return failure(unusable);
  }

  const displayName = extractDisplayName(payload);
  if (displayName === null) {
    return failure(unusable);
  }

  return success(displayName);
}
