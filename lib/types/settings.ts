/**
 * ARCHI-2 — Contrat d'API interne : test de connexion & sauvegarde des paramètres.
 *
 * Fichier de types purs (aucune valeur exécutable, aucun import) : consommable à
 * l'identique depuis `app/api/` (serveur) et depuis un composant front.
 *
 * Jetons (ARCHI-3, BACK-4) — ce que ce contrat garantit, et ce qu'il ne garantit pas.
 *
 * GARANTI : les jetons n'apparaissent que dans les types d'ENTRÉE (`*Credentials`).
 * Aucun type de SORTIE ne déclare de champ jeton, ni optionnel, ni imbriqué. Une fuite
 * ne peut donc pas venir d'une lecture naïve du contrat : en le respectant, il n'existe
 * aucun champ où poser un jeton.
 *
 * NON GARANTI : le typage n'est pas une barrière d'exécution. Le contrôle des propriétés
 * excédentaires de TypeScript ne s'applique qu'à un littéral frais assigné directement ;
 * dès que la valeur passe par une variable intermédiaire ou un spread, un champ non
 * déclaré voyage sans erreur de compilation (`const payload = { block, status: "success",
 * account, ...credentials }; return payload;` compile). `NextResponse.json(body)` ne
 * vérifie pas davantage le corps qu'il sérialise.
 *
 * Conséquence, à la charge de BACK-1, BACK-2, BACK-3 et BACK-4 et vérifiée à l'audit :
 * construire chaque réponse champ par champ, à partir des seules valeurs à exposer.
 * Jamais par spread ni par réutilisation d'un objet contenant des credentials, corps de
 * requête compris. Ce contrat ne dispense d'aucun contrôle en sortie.
 *
 * NON GARANTI, second point, depuis l'arbitrage du 31/08/2026 : les champs `message`
 * sont des chaînes libres. Celui de `PersistedConnectionError` est de plus écrit sur
 * disque par BACK-4 puis relu par `GET /api/settings` — un message qui recopie un jeton
 * n'est plus fugace, il devient durable. Rédaction à la charge de BACK-1/2/3,
 * persistance à la charge de BACK-4.
 *
 * Frontière exacte : ARCHI-3 interdit « la valeur du jeton » (critère d'acceptation,
 * ligne 95 de `docs/tickets/phase-1-configuration.md`), pas les métadonnées durables
 * non secrètes que l'utilisateur a lui-même saisies ou que le provider a confirmées
 * (URL d'instance, nom de compte). Celles-ci figurent en sortie, car FRONT-5 (« pas de
 * valeurs figées/statiques », ligne 292) et FRONT-12 (résumé « icône, nom du
 * compte/instance, statut », ligne 67 de `docs/tickets/phase-3-parametres.md`) doivent
 * les afficher après un rechargement de page.
 */

/* -------------------------------------------------------------------------- */
/* Identifiants                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Les 6 providers IA de la liste fermée (règle produit, ligne 12 des tickets).
 * Type partagé imposé par ARCHI-2b : sert de clé à `Record<ProviderId, ...>` dans
 * `lib/providers-links.ts` et `lib/providers-api.ts`, pour qu'un provider oublié
 * dans l'un des deux fichiers casse la compilation.
 */
export type ProviderId =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "kimi"
  | "grok"
  | "gemini";

/**
 * Les 3 blocs de configuration de l'écran Connexions (FRONT-2, BACK-4).
 * Volontairement nommé « bloc » et non « provider » : `ProviderId` ci-dessus est
 * réservé aux 6 providers IA, et confondre les deux notions dans un même mot
 * rendrait `provider: "ai"` + `provider: "openai"` indistinguables à la lecture.
 */
export type ConnectionBlockId = "jira" | "figma" | "ai";

/* -------------------------------------------------------------------------- */
/* Credentials — déclarés dans les types d'entrée uniquement. Les tenir hors  */
/* des réponses est une obligation d'implémentation, pas un acquis du typage. */
/* -------------------------------------------------------------------------- */

/**
 * Bloc Jira : URL d'instance + email + jeton API (FRONT-2, BACK-1).
 *
 * `email` ajouté le 04/09/2026, après implémentation de BACK-1 : un jeton API Jira
 * **Cloud** classique s'authentifie en Basic auth (`base64(email + ":" + jeton)`), pas en
 * `Authorization: Bearer <jeton>` seul (réservé aux jetons OAuth 2.0 / PAT Data Center).
 * Sans `email`, le Basic auth n'est pas représentable et BACK-1 devait envoyer un `Bearer`
 * dont les sondes réelles (`lib/jira-connection.ts`) montrent qu'il n'est probablement pas
 * le canal attendu par un jeton Cloud standard. Voir `docs/api-contracts.md`.
 */
export interface JiraCredentials {
  instanceUrl: string;
  email: string;
  apiToken: string;
}

/** Bloc Figma : jeton seul (FRONT-2, BACK-2). */
export interface FigmaCredentials {
  apiToken: string;
}

/** Bloc IA : lequel des 6 providers + sa clé (BACK-3 : « un sous-champ précisant lequel des 6 »). */
export interface AiCredentials {
  provider: ProviderId;
  apiToken: string;
}

/* -------------------------------------------------------------------------- */
/* POST /api/settings/test-connection — requête                                */
/* -------------------------------------------------------------------------- */

export interface JiraTestConnectionRequest {
  block: "jira";
  credentials: JiraCredentials;
}

export interface FigmaTestConnectionRequest {
  block: "figma";
  credentials: FigmaCredentials;
}

export interface AiTestConnectionRequest {
  block: "ai";
  credentials: AiCredentials;
}

export interface TestConnectionRequestByBlock {
  jira: JiraTestConnectionRequest;
  figma: FigmaTestConnectionRequest;
  ai: AiTestConnectionRequest;
}

/** Requête pour un bloc précis : `TestConnectionRequestFor<"jira">`. */
export type TestConnectionRequestFor<TBlock extends ConnectionBlockId> =
  TestConnectionRequestByBlock[TBlock];

/**
 * Union discriminée par `block`. Ce que la discrimination fait réellement : à
 * l'écriture, un littéral frais associant des credentials Figma à `block: "jira"` ne
 * compile pas ; à la lecture, tester `block` affine vers le bon variant. Ce n'est pas
 * une validation d'entrée — dès que la valeur transite par une variable intermédiaire
 * ou un spread, la vérification tombe (en-tête, « NON GARANTI »).
 *
 * Conséquence côté serveur : un corps de requête arrivant du réseau n'est pas validé
 * par le typage ; BACK-1, BACK-2, BACK-3 et BACK-4 doivent le valider à la frontière.
 */
export type TestConnectionRequest = TestConnectionRequestFor<ConnectionBlockId>;

/* -------------------------------------------------------------------------- */
/* POST /api/settings/test-connection — réponse                                */
/* -------------------------------------------------------------------------- */

/**
 * Toutes les réponses de test portent `block`, qui est l'ÉCHO du champ homonyme de la
 * requête et n'affirme rien d'autre que « cette réponse concerne ce bloc ».
 *
 * Deux raisons, toutes deux dans les tickets :
 * - la règle produit ligne 10 impose un test automatique au blur (pas de bouton
 *   « Tester ») : plusieurs tests peuvent être en vol en même temps, et le front doit
 *   pouvoir rattacher chaque réponse à son bloc sans se fier à l'ordre d'arrivée ;
 * - sans lui, `TestConnectionResponse` n'est pas une union réellement discriminée :
 *   `status === "success"` seul ne suffit pas à atteindre `account`.
 *
 * Il n'existe volontairement AUCUNE variante `pending`, alors que l'énoncé d'ARCHI-2
 * (ligne 49 de `docs/tickets/phase-1-configuration.md`) écrit
 * `"success" | "error" | "pending"` : arbitrage produit du 31/08/2026, le test de
 * connexion est synchrone et la réponse serveur ne porte que le verdict (divergence
 * assumée n°4 de `docs/api-contracts.md`). L'état « spinner » de FRONT-3 (ligne 245)
 * reste local au front pendant que la requête HTTP est en vol : il n'a pas de
 * représentation dans le contrat.
 */

/**
 * Échec du test. `message` est REQUIS : FRONT-3 impose d'afficher le message précis
 * renvoyé par le backend, jamais un texte générique — un message absent rendrait
 * cette exigence impossible à tenir.
 *
 * `code` reste optionnel : il ne couvre que les cas d'erreur explicitement cités
 * dans BACK-1/2/3. Le rendre obligatoire forcerait le backend à ranger un échec non
 * prévu (ex. coupure réseau côté Figma) dans une catégorie fausse. Le message reste
 * la source d'affichage ; le code n'est qu'un signal machine (ex. distinguer le 429
 * d'un jeton invalide, exigé par BACK-2).
 */
export interface TestConnectionError<
  TBlock extends ConnectionBlockId,
  TCode extends string,
> {
  block: TBlock;
  status: "error";
  message: string;
  code?: TCode;
}

/** Cas d'erreur cités par BACK-1 : URL invalide, jeton invalide, instance injoignable, timeout. */
export type JiraTestConnectionErrorCode =
  | "invalid_url"
  | "invalid_token"
  | "instance_unreachable"
  | "timeout";

/** Cas d'erreur cités par BACK-2 : jeton invalide/expiré, rate-limit 429. */
export type FigmaTestConnectionErrorCode = "invalid_token" | "rate_limited";

/** Cas d'erreur cités par BACK-3 : clé invalide, quota dépassé, provider indisponible. */
export type AiTestConnectionErrorCode =
  | "invalid_token"
  | "quota_exceeded"
  | "provider_unavailable";

/** BACK-1 : succès « avec nom du compte/instance » — donné comme toujours présent. */
export interface JiraAccountInfo {
  accountName: string;
}

/** BACK-2 : « nom du compte Figma si disponible » — d'où l'objet entier optionnel. */
export interface FigmaAccountInfo {
  accountName: string;
}

export interface JiraTestConnectionSuccess {
  block: "jira";
  status: "success";
  account: JiraAccountInfo;
}

export interface FigmaTestConnectionSuccess {
  block: "figma";
  status: "success";
  account?: FigmaAccountInfo;
}

/** BACK-3 ne cite aucune métadonnée de succès pour l'IA : le succès est nu. */
export interface AiTestConnectionSuccess {
  block: "ai";
  status: "success";
}

export type JiraTestConnectionResponse =
  | JiraTestConnectionSuccess
  | TestConnectionError<"jira", JiraTestConnectionErrorCode>;

export type FigmaTestConnectionResponse =
  | FigmaTestConnectionSuccess
  | TestConnectionError<"figma", FigmaTestConnectionErrorCode>;

export type AiTestConnectionResponse =
  | AiTestConnectionSuccess
  | TestConnectionError<"ai", AiTestConnectionErrorCode>;

export interface TestConnectionResponseByBlock {
  jira: JiraTestConnectionResponse;
  figma: FigmaTestConnectionResponse;
  ai: AiTestConnectionResponse;
}

/** Réponse pour un bloc précis : `TestConnectionResponseFor<"figma">`. */
export type TestConnectionResponseFor<TBlock extends ConnectionBlockId> =
  TestConnectionResponseByBlock[TBlock];

/**
 * Union doublement discriminée : `block` d'abord, `status` ensuite. Après
 * `r.block === "jira" && r.status === "success"`, `r.account` est accessible sans cast.
 */
export type TestConnectionResponse =
  TestConnectionResponseFor<ConnectionBlockId>;

/* -------------------------------------------------------------------------- */
/* GET /api/settings — état de la configuration (aucun champ jeton déclaré)    */
/* -------------------------------------------------------------------------- */

/**
 * Statuts imposés par ARCHI-3 et BACK-4. `skipped` (« Passer cette étape ») est
 * distinct de `not_connected` et ne concerne que Figma.
 */
export type ConnectionStatus = "connected" | "not_connected" | "skipped";

/**
 * Dernière cause d'échec connue pour un bloc, rendue durable par BACK-4 et relue par
 * `GET /api/settings` (arbitrage produit du 31/08/2026, décision n°3).
 *
 * Besoin source, et le niveau exact de ce qu'il dit : FRONT-4 ligne 266 exige un bandeau
 * qui « explique précisément quel bloc bloque ». Le *pourquoi* ne vient pas de cette
 * phrase mais du libellé de référence donné en exemple sur la même ligne (« … le jeton du
 * Modèle IA est invalide »), qui nomme la cause — c'est une lecture de ce libellé, pas la
 * lettre de l'exigence. Après un rechargement, `not_connected` seul confond « jamais
 * saisi » et « saisi et invalide ».
 *
 * Même vocabulaire que `TestConnectionError`, dont cette information est la trace
 * persistée : `message` requis (FRONT-3 ligne 246 interdit le texte générique, et
 * FRONT-4 réaffiche ce même message), `code` optionnel (la liste des codes ne couvre que
 * les cas cités par BACK-1/2/3 ; l'imposer forcerait à ranger un échec imprévu dans une
 * catégorie fausse). Pas de champ `block` : il est porté par la clé de `SettingsState`.
 *
 * Rien d'autre n'est déclaré — ni horodatage, ni compteur de tentatives : aucun ticket
 * ni l'arbitrage du 31/08/2026 ne les demande.
 *
 * `message` est une chaîne libre, désormais écrite sur disque : le risque de recopie de
 * jeton décrit en en-tête de ce fichier devient durable. Rédaction à la charge de
 * BACK-1/2/3, persistance à la charge de BACK-4 (§« Risque résiduel » de
 * `docs/api-contracts.md`).
 *
 * Générique sur le code d'erreur du bloc, et sans paramètre par défaut : le citer nu
 * (`const e: PersistedConnectionError = …`) ne compile pas (`TS2314`). Un consommateur
 * écrit toujours l'argument de son bloc, p. ex.
 * `PersistedConnectionError<JiraTestConnectionErrorCode>`.
 */
export interface PersistedConnectionError<TCode extends string> {
  message: string;
  code?: TCode;
}

/**
 * Union discriminée, comme `AiSettingsState` : l'URL d'instance et le nom de compte
 * n'existent que lorsque la connexion est établie, ils ne sont donc pas représentables
 * quand elle ne l'est pas (pas de champ nullable à défendre).
 *
 * - `instanceUrl` : FRONT-2 ligne 221 (« champ URL instance ») doit être pré-rempli au
 *   retour sur l'écran, et FRONT-5 ligne 288 affiche « nom de l'instance Jira ».
 * - `email` : ajouté le 04/09/2026 en même temps que sur `JiraCredentials` — sans lui,
 *   FRONT-2 ne peut pas pré-remplir ce champ au retour sur l'écran (même motif que pour
 *   `instanceUrl`), et un test au blur sur le champ jeton échouerait à tort en « renseigne
 *   ton e-mail » sur une connexion pourtant déjà valide.
 * - `account` : BACK-1 ligne 113 (« succès avec nom du compte/instance ») et FRONT-12
 *   ligne 67 (résumé du bloc replié). Même forme que le succès de test, c'est la même
 *   information, simplement rendue durable par BACK-4.
 *
 * `lastError` n'est déclaré que sur `not_connected`, et nulle part ailleurs : c'est le
 * seul état où le bloc bloque réellement (FRONT-4 ligne 265 : « Terminer » désactivé tant
 * que Jira et l'IA ne sont pas `connected`), donc le seul où FRONT-4 a besoin de la cause.
 * Le porter aussi sur `connected` créerait un champ que rien n'affiche et qui pourrait
 * contredire le statut. Il reste optionnel parce que « jamais saisi » doit rester
 * distinguable de « saisi et invalide » — c'est précisément la confusion que la décision
 * n°3 du 31/08/2026 corrige ; l'absence de `lastError` est cette information.
 *
 * Aucun champ jeton n'est DÉCLARÉ ici : ARCHI-3 n'interdit que la valeur du jeton, et
 * aucune variante de ce type ne prévoit de champ où la poser. Ce n'est pas une garantie
 * d'absence à l'exécution : `lastError.message` est une chaîne libre, écrite sur disque
 * par BACK-4 puis relue à chaque `GET`, et reste soumise à l'obligation de rédaction
 * posée en en-tête de ce fichier (BACK-1/2/3) et à l'obligation de persistance (BACK-4).
 */
export type JiraSettingsState =
  | {
      status: "connected";
      instanceUrl: string;
      email: string;
      account: JiraAccountInfo;
    }
  | {
      status: "not_connected";
      lastError?: PersistedConnectionError<JiraTestConnectionErrorCode>;
    };

/**
 * Seul bloc pouvant porter `skipped`. `account` reste optionnel jusque dans l'état
 * persisté : BACK-2 ligne 139 ne promet le nom du compte Figma que « si disponible »,
 * le rendre requis obligerait le backend à en fabriquer un.
 *
 * `lastError` est présent sur `not_connected` — la décision n°3 du 31/08/2026 porte sur
 * les trois blocs — mais pas sur `skipped` : « Passer cette étape » (BACK-4 ligne 179) est
 * une action explicite de l'utilisateur, pas un échec, et Figma ne bloque jamais
 * « Terminer » (FRONT-4 ligne 265). Un `lastError` sur `skipped` n'aurait aucun lecteur.
 */
export type FigmaSettingsState =
  | { status: "connected"; account?: FigmaAccountInfo }
  | {
      status: "not_connected";
      lastError?: PersistedConnectionError<FigmaTestConnectionErrorCode>;
    }
  | { status: "skipped" };

/**
 * BACK-4 : « pour l'IA, le provider actif ». Union discriminée : le provider actif
 * n'existe que lorsque la connexion est établie, il n'y a donc pas de `null` à gérer.
 *
 * `lastError` sur `not_connected`, même motif que pour Jira : l'IA fait partie des deux
 * blocs qui bloquent « Terminer » (FRONT-4 ligne 265), et son exemple de bandeau
 * (« le jeton du Modèle IA est invalide », ligne 266) est exactement une cause d'échec.
 */
export type AiSettingsState =
  | { status: "connected"; provider: ProviderId }
  | {
      status: "not_connected";
      lastError?: PersistedConnectionError<AiTestConnectionErrorCode>;
    };

/**
 * État de la configuration. Aucun champ jeton, y compris optionnel : ce qui est exposé
 * d'un jeton, c'est l'existence d'une connexion valide (`status`), les métadonnées que
 * l'utilisateur voit déjà à l'écran (URL d'instance, nom de compte) et, depuis le
 * 31/08/2026, la cause du dernier échec (`lastError.message`) — jamais sa valeur.
 *
 * `lastError.message` étant une chaîne libre, c'est le seul champ de `SettingsState` par
 * lequel un jeton pourrait transiter par accident : voir `PersistedConnectionError`.
 */
export interface SettingsState {
  jira: JiraSettingsState;
  figma: FigmaSettingsState;
  ai: AiSettingsState;
}

/**
 * Réponse de `GET /api/settings`. La variante d'erreur est indispensable : FRONT-1
 * ligne 200 conditionne l'affichage du wizard à « aucune configuration n'existe
 * encore », et ARCHI-3 rend l'échec de lecture réel (fichier chiffré illisible, clé de
 * chiffrement absente). Sans elle, une panne de lecture serait indistinguable d'un état
 * vide et resservirait l'onboarding à un utilisateur déjà configuré.
 *
 * `message` est requis, pour la même raison que sur le test de connexion : l'affichage
 * doit être précis. Aucun `code` ici : aucun ticket n'en cite pour ce cas.
 *
 * `SettingsState` reste un type à part, réutilisé hors de cette réponse.
 */
export type GetSettingsResponse =
  | { status: "success"; settings: SettingsState }
  | { status: "error"; message: string };

/* -------------------------------------------------------------------------- */
/* POST /api/settings — sauvegarde d'un bloc à la fois                         */
/* -------------------------------------------------------------------------- */

export interface JiraSettingsUpdate {
  block: "jira";
  credentials: JiraCredentials;
}

/**
 * Figma se sauvegarde soit avec un jeton, soit comme explicitement passé
 * (BACK-4 : `skipped` posé sur clic « Passer cette étape »). Le littéral `true`
 * évite un `skipped: false` dont le sens serait indéterminé.
 */
export type FigmaSettingsUpdate =
  | { block: "figma"; credentials: FigmaCredentials }
  | { block: "figma"; skipped: true };

export interface AiSettingsUpdate {
  block: "ai";
  credentials: AiCredentials;
}

export interface SettingsUpdateByBlock {
  jira: JiraSettingsUpdate;
  figma: FigmaSettingsUpdate;
  ai: AiSettingsUpdate;
}

export type SettingsUpdateFor<TBlock extends ConnectionBlockId> =
  SettingsUpdateByBlock[TBlock];

/** Un seul bloc par requête (BACK-4), discriminé par `block`. */
export type SaveSettingsRequest = SettingsUpdateFor<ConnectionBlockId>;

/**
 * Même vocabulaire de statut que le test de connexion ; `message` requis en erreur.
 *
 * `block` y est porté pour la même raison et avec la même sémantique d'écho que sur
 * `TestConnectionResponse` : il reprend le `block` de la requête et n'affirme rien
 * d'autre que « cette réponse concerne ce bloc ». BACK-4 sauvegarde chaque connexion dès
 * qu'elle est validée, donc dans le flux du test automatique au blur (règle produit,
 * ligne 10) : deux sauvegardes peuvent être en vol en même temps, et sans `block` le
 * front afficherait l'erreur de Figma sur le bloc Jira.
 */
export type SaveSettingsResponse =
  | { block: ConnectionBlockId; status: "success" }
  | { block: ConnectionBlockId; status: "error"; message: string };
