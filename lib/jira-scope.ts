/**
 * BACK-5 — Résolution du périmètre de comparaison (Linked Issues → Epic/Component).
 *
 * Module SERVEUR uniquement : il lit le coffre chiffré (BACK-4) et révèle le jeton Jira pour
 * construire l'en-tête d'authentification. Il ne doit jamais être importé depuis un composant
 * client, il ne persiste rien, il ne journalise rien (`console.*` interdit, même en débogage)
 * et il ne déclenche AUCUN appel IA. Il ne lit des tickets Jira que leurs CLÉS : le comptage
 * (BACK-6) s'arrête au nombre et la lecture des contenus du corpus est la charge de BACK-7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALGORITHME — règle produit (docs/tickets/phase-2-analyse-ticket.md, BACK-5)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Lecture du ticket cible : GET /rest/api/3/issue/{key}?fields=issuelinks,parent,components.
 * 2. Si `issuelinks` contient des clés : méthode `linked_issues`. Les tickets liés sont ensuite
 *    filtrés par ancienneté via UNE recherche JQL `key in (...) AND updated >= "…"` — les
 *    objets `issuelinks` ne portent pas la date `updated` des tickets liés, la seule façon
 *    d'appliquer le palier sans lire chaque ticket est donc de laisser Jira filtrer.
 * 3. Si aucun lien : repli sur la recherche JQL par Epic/Component du ticket, même filtre
 *    d'ancienneté, en UNE recherche : `(<epic> OR <composants>) AND updated >= "…"`.
 * 4. Dans tous les cas : exclusion du ticket cible (le repli le retrouve forcément, il
 *    appartient à son propre epic/component) et déduplication.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DÉCISIONS ET AMBIGÜITÉS TRANCHÉES — à confronter à une instance réelle
 * ─────────────────────────────────────────────────────────────────────────────
 * Aucune sonde réelle n'est disponible (pas de jeton dans cet environnement) : chaque choix
 * ci-dessous est l'interprétation la plus simple du comportement Jira, documentée pour être
 * vérifiée au premier test avec une instance réelle (voir aussi `docs/mcp-status.md`).
 *
 * 1. « Epic » DU TICKET = champ STANDARD `parent` (JQL `parent = "CLÉ"`). Sur les projets à
 *    hiérarchie (team-managed, le défaut des nouvelles instances Cloud), le parent d'un
 *    ticket est son epic, et `parent = EPIC-1` renvoie les tickets du même epic. Le champ
 *    « Epic Link » des projets company-managed classiques est un champ PERSONNALISÉ dont
 *    l'identifiant varie par instance (`customfield_…`) : le demander en dur ou par nom serait
 *    inventer un champ, et une JQL `"Epic Link" = …` émise à l'aveugle ferait échouer en HTTP
 *    400 sur les instances qui n'ont pas ce champ (team-managed). NON COUVERT, faute de sonde :
 *    à trancher au premier test réel (lire `/rest/api/3/field` pour résoudre l'identifiant du
 *    champ « Epic Link » si le besoin se confirme).
 * 2. `components` (champ standard, ajouté aux champs demandés) porte le volet « Component du
 *    ticket » du repli. `issuetype`, listé dans l'énoncé du ticket, n'est PAS demandé : il
 *    n'aurait servi qu'à deviner par NOM (« ce ticket est un Epic ») que le ticket cible est
 *    lui-même un epic — deviner un nom d'issuetype est une heuristique de plus, écartée. Cas
 *    non couvert qui en découle : un ticket qui EST un epic n'a pas de `parent` propre ; son
 *    corpus (« les tickets de cet epic ») n'est pas résolu — simplification assumée.
 * 3. Sous-cas non couvert, même famille : un ticket SOUS-TÂCHE a pour `parent` son ticket
 *    parent (pas un epic) ; le repli renvoie alors ses sous-tâches sœurs. Accepté : la
 *    hiérarchie réelle ne se devine pas sans nommer des types.
 * 4. Date de filtre : `updated >= "AAAA-MM-JJTHH:mm:ss.SSS+0000"` (ISO 8601, offset numérique
 *    sans deux-points, format classique documenté par Atlassian pour la JQL). Le suffixe `Z`
 *    est aussi ISO mais n'est pas la forme des exemples Atlassian : `+0000` retenu.
 * 5. Fenêtres `6m`/`12m` : soustraction de mois CALENDAIRES UTC (pas de durée fixe en jours,
 *    le produit dit « 6 mois », pas « 183 jours »). Quirk accepté : un quantième qui
 *    déborderait est normalisé par `Date.UTC` (31 mars − 6 mois → 1ᵉʳ octobre).
 * 6. Plafond de la recherche : `maxResults=200` (SCOPE_MAX_RESULTS). Au-delà, les clés sont
 *    tronquées silencieusement au plafond — un corpus IA doit rester borné. Conséquence pour
 *    BACK-6 : un comptage exact au-delà de 200 tickets ne peut pas se contenter de ces clés ;
 *    à arbitrer avec l'orchestrateur (lire `total` de la réponse de recherche).
 * 7. Précédence stricte : si le ticket A des liens mais que le filtre d'ancienneté les élimine
 *    tous, la méthode reste `linked_issues` (clés vides) — on ne retombe PAS sur
 *    epic/component, la règle produit est « des Linked Issues renseignés ignorent
 *    Epic/Component », pas « des liens RÉCENTS ».
 * 8. Mode manuel (pas de ticketKey) : `scopeHint` rempli → méthode `epic_component` avec ZÉRO
 *    clé ; sinon `none`. Jamais d'appel Jira, jamais d'erreur. « Epic / composant » est
 *    littéralement le nom du champ de saisie manuelle (FRONT-7) : le qualifier
 *    `epic_component` est le seul libellé honnête de l'union à trois valeurs, et `linked_issues`
 *    serait un mensonge (pas de liens sans Jira). Les clés sont vides PAR CONSTRUCTION : le
 *    corpus manuel n'a pas de clés Jira, c'est le texte de `scopeHint` que BACK-7 portera à
 *    l'IA. Ce n'est pas un « succès vide » au sens du pipeline : la résolution manuelle
 *    n'interroge aucune source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SÉCURITÉ — invariants tenus par ce module
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Le jeton ne quitte le coffre qu'à UN SEUL endroit nommé de ce fichier
 *    (`readJiraApiAccess`, appel à `revealSecret`), et uniquement pour alimenter
 *    `buildAuthorizationHeader` (exporté par `lib/jira-connection.ts`, source unique du
 *    format Basic). L'audit relit les appels à `revealSecret` (`grep revealSecret`).
 * 2. Aucun message d'erreur ne recopie un jeton, une adresse e-mail, une URL saisie, un corps
 *    de réponse Jira ni une requête JQL : les messages sont rédigés ici, à partir du code HTTP
 *    (donnée non sensible) et de la cause de transport classifiée. Seule la clé du ticket
 *    demandé peut être citée (elle n'est pas sensible et aide l'utilisateur).
 * 3. Les redirections ne sont pas suivies (`redirect: "manual"`) : suivre un `3xx` rejouerait
 *    l'en-tête `Authorization` vers un hôte que l'utilisateur n'a pas validé.
 * 4. Réessais : 3 tentatives au plus sur `429` et `5xx` uniquement, repli exponentiel, en
 *    respectant `Retry-After` quand il est présent (plafonné : une route HTTP ne peut pas
 *    dormir des dizaines de secondes). JAMAIS de réessai sur `401`/`403`/`404`/`4xx` : le
 *    jeton ne va pas s'améliorer tout seul, et insister peut faire bloquer le compte.
 * 5. Chaque tentative a son propre délai maximal (`AbortSignal.timeout`,
 *    JIRA_SCOPE_TIMEOUT_MS = 10 s, aligné sur JIRA_TEST_TIMEOUT_MS) : un connecteur qui pend
 *    ne doit pas figer le pipeline.
 *
 * Ce module ne lève jamais : tout échec — y compris une entrée aberrante — ressort en
 * `{ status: "error", message }`, parce que l'appelant est une route HTTP dont le crash
 * serait un `500` sans explication. Un ticket sans lien ni epic/component ressort en
 * `{ status: "success", method: "none" }` SANS erreur : le pipeline continue en traduction
 * seule (critère d'acceptation BACK-5).
 */

import type { ComparisonWindow, ScopeCountParams } from "@/lib/types/analysis";
import { buildAuthorizationHeader } from "@/lib/jira-connection";
import { revealSecret } from "@/lib/secret";
import { getSettingsStore } from "@/lib/settings-store";

/* -------------------------------------------------------------------------- */
/* Constantes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Délai maximal de CHAQUE tentative d'appel Jira, corps de réponse compris. Aligné sur
 * `JIRA_TEST_TIMEOUT_MS` (BACK-1) : la même dizaine de secondes, pas une valeur dérivée
 * différente qui rendrait les deux modules incohérents. Exporté pour que les tests puissent
 * l'abaisser sans dupliquer la valeur (motif d'`AI_TEST_TIMEOUT_MS`).
 */
export const JIRA_SCOPE_TIMEOUT_MS = 10_000;

/**
 * Nombre maximal de tentatives par appel Jira (429 et 5xx seulement — voir l'en-tête, §4).
 * Trois tentatives, puis échec net : au-delà, l'instance est vraiment indisponible ou
 * vraiment en train de limiter, et l'utilisateur a droit à un message clair.
 */
export const JIRA_SCOPE_MAX_ATTEMPTS = 3;

/** Délai de base du repli exponentiel (tentative n → base × 2^(n−1)) : 250 ms puis 500 ms. */
const RETRY_BASE_DELAY_MS = 250;

/**
 * Plafond d'attente d'un `Retry-After` : la route HTTP qui appelle ce module ne peut pas
 * dormir des dizaines de secondes (le front attendrait derrière un spinner). On honore
 * l'en-tête jusqu'à 3 s, puis on retente ; après épuisement des tentatives, le message 429
 * dit à l'utilisateur de patienter.
 */
const MAX_RETRY_AFTER_MS = 3_000;

/**
 * `maxResults` des recherches JQL du périmètre. Deux raisons, documentées :
 * - un corpus destiné à l'IA (BACK-7) doit rester borné : au-delà de 200 tickets, chaque
 *   ajout rapporte moins de contexte que de coût ;
 * - JQL sans `maxResults` plafonne à 50 par défaut — une valeur implicite pire que n'importe
 *   quelle valeur explicite.
 * La troncature au-delà de 200 est documentée dans l'en-tête (§6) : BACK-6, qui compte,
 * devra arbitrer avec l'orchestrateur si un périmètre peut dépasser ce plafond.
 */
export const SCOPE_MAX_RESULTS = 200;

/** Fenêtres fixes en jours — les paliers `6m`/`12m` sont, eux, des mois calendaires (§5). */
const DAY_WINDOW_MILLIS: Readonly<Record<"7d" | "30d" | "90d", number>> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

/** Les 5 paliers, pour la garde d'entrée (une valeur hors union ne doit pas compiler ni passer). */
const COMPARISON_WINDOWS: readonly ComparisonWindow[] = ["7d", "30d", "90d", "6m", "12m"];

/* -------------------------------------------------------------------------- */
/* Types publics                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Méthode par laquelle le périmètre de comparaison a été résolu (BACK-5, critère de
 * transparence FRONT-10) :
 * - `linked_issues` : des liens Jira existaient sur le ticket cible (ils priment) ;
 * - `epic_component` : repli par epic/component (Jira), ou champ « Epic / composant » saisi à
 *   la main (mode manuel) ;
 * - `none` : aucune source de comparaison — le pipeline continue en traduction seule.
 */
export type ScopeMethod = "linked_issues" | "epic_component" | "none";

/** Résolution réussie : la méthode employée, et les clés des tickets du périmètre. */
export interface ScopeResolved {
  readonly status: "success";
  readonly method: ScopeMethod;
  readonly ticketKeys: readonly string[];
}

/** Résolution en échec : un message français précis, sans donnée sensible (voir en-tête §2). */
export interface ScopeResolutionError {
  readonly status: "error";
  readonly message: string;
}

/**
 * Ne lève jamais (voir en-tête). `method: "none"` est un SUCCÈS avec zéro clé, pas une
 * erreur : c'est le signal « aucune comparaison possible » que le pipeline doit laisser
 * passer sans blocage.
 */
export type ScopeResolution = ScopeResolved | ScopeResolutionError;

/**
 * Réglages d'appel, tous optionnels. Points d'injection réservés aux tests — la route HTTP
 * appelle sans ce paramètre, comme `TestAiConnectionOptions` de `lib/ai-connection.ts`.
 * `fetchImpl` permet de stubbé le réseau SANS toucher au `fetch` global ; `now` fige
 * l'horloge pour tester les 5 paliers ; `timeoutMs` et `retryBaseDelayMs` évitent d'attendre
 * les durées de production dans la suite.
 */
export interface ResolveScopeOptions {
  readonly fetchImpl?: FetchLike;
  readonly now?: Date;
  readonly timeoutMs?: number;
  readonly retryBaseDelayMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Entrée                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Résout le périmètre de comparaison d'une analyse.
 *
 * Dispatch par présence de `ticketKey` (même convention que l'union `AnalysisRequest`
 * d'ARCHI-4 et que `ScopeCountParams`) :
 * - `ticketKey` renseigné → mode Jira : résolution automatique (Linked Issues →
 *   Epic/Component) avec le palier d'ancienneté ; nécessite une connexion Jira `connected`
 *   dans le coffre, sinon erreur précise ;
 * - `ticketKey` absent → mode manuel : seul `scopeHint` compte, AUCUN appel Jira (ni coffre,
 *   ni réseau) — rempli → `epic_component` sans clé, vide → `none`.
 *
 * En mode Jira, `scopeHint` est ignoré : le périmètre est résolu automatiquement (BACK-5,
 * ligne 74 des tickets : « en mode Jira … BACK-7 n'en fait pas usage »).
 */
export async function resolveComparisonScope(
  input: ScopeCountParams,
  options: ResolveScopeOptions = {},
): Promise<ScopeResolution> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.comparisonWindow !== "string" ||
    !isComparisonWindow(input.comparisonWindow)
  ) {
    return failure(
      "La demande de résolution du périmètre est incomplète ou mal formée : indique une fenêtre de comparaison parmi les 5 paliers (7j, 30j, 90j, 6 mois, 12 mois).",
    );
  }

  const hasKey = typeof input.ticketKey === "string" && input.ticketKey.trim() !== "";
  if (!hasKey) {
    return resolveManualScope(input.scopeHint);
  }

  const access = await readJiraApiAccess();
  if (!access.ok) {
    return failure(access.message);
  }

  const key = (input.ticketKey as string).trim();
  return resolveJiraScope(key, input.comparisonWindow, access.access, options);
}

/* -------------------------------------------------------------------------- */
/* Mode manuel                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Mode manuel : aucune source interrogée. Le champ « Epic / composant » (`scopeHint`)
 * remplit → comparaison possible par ce hint (`epic_component`), vide → `none`. Voir
 * l'en-tête §8 pour le pourquoi du libellé et des clés vides.
 */
function resolveManualScope(rawScopeHint: unknown): ScopeResolution {
  const hint = typeof rawScopeHint === "string" ? rawScopeHint.trim() : "";
  return hint === "" ? success("none", []) : success("epic_component", []);
}

/* -------------------------------------------------------------------------- */
/* Lecture de la connexion Jira persistée (coffre BACK-4)                      */
/* -------------------------------------------------------------------------- */

/** Accès réseau dérivé du coffre : base d'URL de l'API et en-tête prêt à poser. */
interface JiraApiAccess {
  readonly apiBase: string;
  readonly authorization: string;
}

type AccessResult = { readonly ok: true; readonly access: JiraApiAccess } | { readonly ok: false; readonly message: string };

const MESSAGE_NOT_CONNECTED =
  "Jira n'est pas connecté : pour comparer un ticket Jira à son périmètre, connecte d'abord ton instance dans les Paramètres (bloc Jira).";

/**
 * Lit le coffre par le chemin réel de production (`getSettingsStore()` → `store.read()`) et
 * dérive l'accès API. Le jeton révélé ici est passé SANS intermédiaire à
 * `buildAuthorizationHeader` : c'est le seul endroit de ce module où `revealSecret`
 * apparaît (en-tête §1), et la valeur ne transite par aucune variable conservée au-delà de
 * la construction de l'en-tête.
 *
 * L'URL persistée a été validée à la sauvegarde (BACK-1 via BACK-4), mais le coffre peut
 * avoir été édité hors de l'application : les deux gardes ci-dessous (URL valide, `https://`)
 * sont de la défense en profondeur, pas du luxe — un jeton en Basic sur `http://` voyagerait
 * en clair (invariant 6 de `lib/jira-connection.ts`).
 */
async function readJiraApiAccess(): Promise<AccessResult> {
  const store = getSettingsStore();
  const result = await store.read();

  // Coffre illisible : le message du coffre est déjà français et sans jeton (il vient du
  // décodage), on le remonte tel quel — jamais rabattu sur « Jira non connecté », qui
  // orienterait l'utilisateur vers une reconnexion alors que le problème est le disque.
  if (result.status === "error") {
    return { ok: false, message: result.message };
  }
  if (result.status === "absent") {
    return { ok: false, message: MESSAGE_NOT_CONNECTED };
  }

  const jira = result.value.jira;
  if (jira.status !== "connected") {
    return { ok: false, message: MESSAGE_NOT_CONNECTED };
  }

  const rawUrl = jira.instanceUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      message:
        "L'URL de l'instance Jira enregistrée dans les Paramètres n'est pas une URL valide : reconnecte Jira pour la corriger.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      message:
        "L'instance Jira enregistrée dans les Paramètres n'est pas en https:// : reconnecte Jira avec une adresse sécurisée avant de lancer l'analyse.",
    };
  }

  // Le chemin éventuel d'instance (servie sous un préfixe) est conservé, comme dans
  // `lib/jira-connection.ts` ; la requête et le fragment, eux, n'ont rien à y faire.
  const apiBase = parsed.origin + parsed.pathname.replace(/\/+$/, "");

  // UNIQUE endroit de ce module où le jeton quitte le coffre (en-tête §1).
  const token = revealSecret(jira.apiToken);
  return {
    ok: true,
    access: { apiBase, authorization: buildAuthorizationHeader(jira.email, token) },
  };
}

/* -------------------------------------------------------------------------- */
/* Résolution du périmètre en mode Jira                                        */
/* -------------------------------------------------------------------------- */

/** Les champs demandés au ticket cible — voir l'en-tête §1 et §2 pour le « pourquoi » de chacun. */
const TARGET_FIELDS = "issuelinks,parent,components";

/**
 * Résout le périmètre d'un ticket Jira. Ne lit du ticket que les clés : les seuls contenus
 * extraits sont les clés des liens, la clé du parent et les NOMS de composants — ces noms
 * sont des valeurs JQL, pas des contenus de ticket à comparer.
 */
async function resolveJiraScope(
  key: string,
  comparisonWindow: ComparisonWindow,
  access: JiraApiAccess,
  options: ResolveScopeOptions,
): Promise<ScopeResolution> {
  const startIso = formatJqlInstant(windowStartUtc(options.now ?? new Date(), comparisonWindow));

  // 1. Lecture du ticket cible.
  const issueUrl = new URL(
    `${access.apiBase}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${TARGET_FIELDS}`,
  );
  const issueCall = await jiraCall(issueUrl, access.authorization, options);
  if (!issueCall.ok) {
    return failure(describeIssueFailure(issueCall, key));
  }

  const shape = readIssueShape(issueCall.payload);
  if (shape === null) {
    return failure(MESSAGE_UNUSABLE_RESPONSE);
  }

  // 2. Liens présents → méthode linked_issues (ils priment sur epic/component, même si le
  //    filtre d'ancienneté vide ensuite le corpus — en-tête §7).
  const linked = withoutTargetKey(shape.linkedKeys, key);
  if (linked.length > 0) {
    const jql = `key in (${linked.map(quoteJqlString).join(", ")}) AND updated >= ${quoteJqlString(startIso)}`;
    const search = await runScopeSearch(access, jql, options);
    if (search.error !== null) {
      return failure(search.error);
    }
    return success("linked_issues", withoutTargetKey(search.keys, key));
  }

  // 3. Repli epic/component. Aucune clause possible → « none » SANS erreur (critère
  //    d'acceptation : le pipeline continue en traduction seule).
  const fallbackJql = buildFallbackJql(shape.parentKey, shape.componentNames, startIso);
  if (fallbackJql === null) {
    return success("none", []);
  }

  const search = await runScopeSearch(access, fallbackJql, options);
  if (search.error !== null) {
    return failure(search.error);
  }
  return success("epic_component", withoutTargetKey(search.keys, key));
}

/**
 * Construit la clause JQL du repli, ou `null` si le ticket n'a ni epic (par `parent`) ni
 * composant — auquel cas l'appelant répond `none`. Le filtre d'ancienneté est DANS la
 * requête (`updated >= …`) : Jira ne renvoie que les tickets de la fenêtre, aucune lecture
 * de contenu n'est nécessaire pour l'appliquer.
 */
function buildFallbackJql(
  parentKey: string | null,
  componentNames: readonly string[],
  startIso: string,
): string | null {
  const clauses: string[] = [];
  if (parentKey !== null) {
    clauses.push(`parent = ${quoteJqlString(parentKey)}`);
  }
  if (componentNames.length > 0) {
    clauses.push(`component in (${componentNames.map(quoteJqlString).join(", ")})`);
  }
  if (clauses.length === 0) {
    return null;
  }
  return `(${clauses.join(" OR ")}) AND updated >= ${quoteJqlString(startIso)}`;
}

/** Lance la recherche JQL du périmètre et n'en garde que les clés. */
async function runScopeSearch(
  access: JiraApiAccess,
  jql: string,
  options: ResolveScopeOptions,
): Promise<{ readonly keys: readonly string[]; readonly error: string | null }> {
  const url = new URL(
    `${access.apiBase}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=key&maxResults=${SCOPE_MAX_RESULTS}`,
  );
  const call = await jiraCall(url, access.authorization, options);
  if (!call.ok) {
    return { keys: [], error: describeSearchFailure(call) };
  }

  const keys = readSearchKeys(call.payload);
  if (keys === null) {
    return { keys: [], error: MESSAGE_UNUSABLE_RESPONSE };
  }
  return { keys, error: null };
}

/* -------------------------------------------------------------------------- */
/* Bornes de la fenêtre d'ancienneté                                           */
/* -------------------------------------------------------------------------- */

/**
 * Instant de début de la fenêtre, en UTC : maintenant moins le palier. Les paliers
 * `7d`/`30d`/`90d` sont des durées fixes ; `6m`/`12m` sont des mois CALENDAIRES UTC
 * (en-tête §5) — jamais une durée en jours, le produit dit « 6 mois ».
 */
function windowStartUtc(now: Date, window: ComparisonWindow): Date {
  if (window === "7d" || window === "30d" || window === "90d") {
    return new Date(now.getTime() - DAY_WINDOW_MILLIS[window]);
  }

  const months = window === "6m" ? 6 : 12;
  // `Date.UTC` normalise les débordements de quantième (31 mars − 6 mois → 1ᵉʳ octobre) :
  // quirk accepté, documenté en-tête §5.
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - months,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

/**
 * Formate un instant pour la JQL : ISO 8601 avec offset numérique `+0000` (en-tête §4).
 * `toISOString()` produit `…Z` ; on remplace le suffixe plutôt que de reformater à la main,
 * pour ne pas réintroduire une erreur de zéros.
 */
function formatJqlInstant(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, -1)}+0000`;
}

/** Échappe une valeur pour un littéral de chaîne JQL (antislash puis guillemet). */
function quoteJqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Garde d'entrée : seules les 5 valeurs de l'union sont admises à l'exécution. */
function isComparisonWindow(value: unknown): value is ComparisonWindow {
  return typeof value === "string" && (COMPARISON_WINDOWS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Lecture des réponses Jira — défensive, aucune donnée inventée               */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Forme utile du ticket cible, extraite de la réponse de `GET /rest/api/3/issue`. */
interface IssueShape {
  readonly linkedKeys: readonly string[];
  readonly parentKey: string | null;
  readonly componentNames: readonly string[];
}

/**
 * Extrait la forme du ticket. `null` = réponse 200 dont le corps n'a pas la forme d'un
 * ticket Jira (proxy d'entreprise, portail d'authentification…) — jamais confondu avec un
 * ticket sans liens ni composants, qui est une forme VALIDE (tableaux vides / `parent:
 * null`).
 *
 * La structure des `issuelinks` est celle documentée par Atlassian : chaque entrée porte le
 * ticket lié sous `outwardIssue` (le ticket cible est la source du lien) ou `inwardIssue`
 * (il en est la cible). Les deux côtés sont lus : un lien où le ticket cible est la cible
 * n'a pas d'`outwardIssue`. NON VÉRIFIÉ sur instance réelle (pas de jeton disponible) :
 * forme écrite d'après la documentation, à confronter au premier test réel.
 */
function readIssueShape(payload: unknown): IssueShape | null {
  if (!isRecord(payload)) {
    return null;
  }
  const fields = payload.fields;
  if (!isRecord(fields)) {
    return null;
  }

  const linkedKeys: string[] = [];
  if (Array.isArray(fields.issuelinks)) {
    for (const link of fields.issuelinks) {
      if (!isRecord(link)) {
        continue;
      }
      for (const side of ["outwardIssue", "inwardIssue"] as const) {
        const linked = link[side];
        if (isRecord(linked) && typeof linked.key === "string") {
          linkedKeys.push(linked.key);
        }
      }
    }
  }

  let parentKey: string | null = null;
  const parent = fields.parent;
  if (isRecord(parent) && typeof parent.key === "string") {
    parentKey = parent.key;
  }

  const componentNames: string[] = [];
  if (Array.isArray(fields.components)) {
    for (const component of fields.components) {
      if (isRecord(component) && typeof component.name === "string") {
        componentNames.push(component.name);
      }
    }
  }

  return { linkedKeys, parentKey, componentNames };
}

/**
 * Extrait les clés d'une réponse de recherche. `null` = corps 200 qui n'a pas la forme
 * d'une réponse de recherche (`issues` absent) — y compris un 200 vide mais inattendu.
 * Un `issues: []` LÉGITIME (aucun ticket ne matche) est, lui, une forme valide qui renvoie
 * une liste vide : c'est la distinction « succès vide ≠ panne » du pipeline.
 */
function readSearchKeys(payload: unknown): string[] | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (!Array.isArray(payload.issues)) {
    return null;
  }
  const keys: string[] = [];
  for (const issue of payload.issues) {
    if (isRecord(issue) && typeof issue.key === "string") {
      keys.push(issue.key);
    }
  }
  return keys;
}

/** Déduplication préservant l'ordre, insensible à la casse (les clés Jira sont majuscules). */
function uniqueKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    const upper = key.toUpperCase();
    if (!seen.has(upper)) {
      seen.add(upper);
      out.push(key);
    }
  }
  return out;
}

/** Retire le ticket cible du corpus (le repli epic/component le retrouve forcément). */
function withoutTargetKey(keys: readonly string[], targetKey: string): string[] {
  const target = targetKey.toUpperCase();
  return uniqueKeys(keys).filter((key) => key.toUpperCase() !== target);
}

/* -------------------------------------------------------------------------- */
/* Transport HTTP — classification et messages                                 */
/* -------------------------------------------------------------------------- */

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Issue d'un appel Jira, classifiée — le code HTTP est une donnée non sensible. */
type JiraCall =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly kind: "timeout"; readonly timeoutMs: number }
  | { readonly ok: false; readonly kind: "network"; readonly error: unknown }
  | {
      readonly ok: false;
      readonly kind: "rate_limited";
      readonly status: number;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly ok: false; readonly kind: "server"; readonly status: number }
  | { readonly ok: false; readonly kind: "http_error"; readonly status: number }
  | { readonly ok: false; readonly kind: "unusable"; readonly status: number };

/**
 * Appel GET Jira avec réessais (en-tête §4 et §5). Ne lit le corps QUE sur un `2xx` : sur
 * un échec, le corps est jeté sans être matérialisé — les proxies d'entreprise y recopient
 * parfois des pages entières, et rien ici n'a besoin de ce contenu.
 */
async function jiraCall(
  url: URL,
  authorization: string,
  options: ResolveScopeOptions,
): Promise<JiraCall> {
  const doFetch: FetchLike = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? JIRA_SCOPE_TIMEOUT_MS;
  const baseDelayMs = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;

  for (let attempt = 1; attempt <= JIRA_SCOPE_MAX_ATTEMPTS; attempt += 1) {
    // Signal neuf par tentative : un délai consommé par la tentative précédente ne doit pas
    // couper la suivante.
    const signal = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: authorization,
          Accept: "application/json",
        },
        // Jamais suivie : rejouer l'en-tête d'authentification vers un hôte non validé
        // exposerait le jeton (en-tête §3).
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch (error: unknown) {
      // Abandon par notre propre délai (selon la version de Node : `TimeoutError` ou
      // `AbortError`) — le signal est la source de vérité, comme dans `lib/jira-connection.ts`.
      if (signal.aborted) {
        return { ok: false, kind: "timeout", timeoutMs };
      }
      return { ok: false, kind: "network", error };
    }

    const status = response.status;

    // Réessai : 429 et 5xx uniquement. Le corps n'est pas lu, juste libéré.
    if (status === 429 || status >= 500) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
      await discardBody(response);

      if (attempt < JIRA_SCOPE_MAX_ATTEMPTS) {
        const delayMs =
          retryAfterSeconds === null
            ? baseDelayMs * 2 ** (attempt - 1)
            : Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
        await sleep(delayMs);
        continue;
      }
      return status === 429
        ? { ok: false, kind: "rate_limited", status, retryAfterSeconds }
        : { ok: false, kind: "server", status };
    }

    // Autre échec HTTP (401, 403, 404, 3xx, 4xx…) : jamais de réessai (en-tête §4).
    if (!response.ok) {
      await discardBody(response);
      return { ok: false, kind: "http_error", status };
    }

    // 2xx : le corps doit être du JSON. Un 200 non JSON n'est pas un succès (proxy captif).
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, kind: "unusable", status };
    }
    return { ok: true, payload };
  }

  // Inatteignable : la boucle ne sort que par `return`. Présent pour que le compilateur
  // n'exige pas un retour implicite `undefined` après la boucle.
  return { ok: false, kind: "http_error", status: 0 };
}

/** Libère la connexion sans matérialiser le corps (motif de `lib/ai-connection.ts`). */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Corps déjà clos ou connexion coupée : sans effet sur le verdict.
  }
}

/** `Retry-After` en secondes, borné comme dans `lib/jira-connection.ts`. `null` = absent ou inexploitable. */
function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  const seconds = Number.parseInt(header.trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 ? seconds : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Récupère le code d'erreur système d'un échec `fetch` (`ENOTFOUND`, `ECONNREFUSED`…),
 * exposé par Node sur `cause`, parfois imbriqué. Miroir de
 * `extractSystemErrorCode`/`lib/jira-connection.ts` (non exportée) : si l'une change,
 * reporter sur l'autre.
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
 * Réponse 200 dont le corps n'a pas la forme attendue de l'API Jira. Partagée par les deux
 * lectures : ni extrait du corps, ni URL citée (en-tête §2).
 */
const MESSAGE_UNUSABLE_RESPONSE =
  "L'instance Jira configurée a répondu (HTTP 200), mais sa réponse n'a pas la forme attendue de l'API Jira. Un portail d'authentification d'entreprise (proxy ou VPN) peut s'être interposé : vérifie l'URL de l'instance dans les Paramètres, ou signale le problème s'il persiste.";

function describeAuthFailure(status: number): string {
  return `L'instance Jira configurée a refusé l'authentification (HTTP ${status}). Le jeton enregistré dans les Paramètres est peut-être expiré ou révoqué : reconnecte Jira pour le renouveler, puis retente l'analyse.`;
}

function describeRateLimited(): string {
  return "L'instance Jira configurée a temporairement limité le nombre de requêtes (HTTP 429). Attends quelques instants, puis relance l'analyse.";
}

function describeServerFailure(status: number): string {
  return `L'instance Jira configurée a répondu par une erreur serveur (HTTP ${status}). Elle est probablement indisponible ou en maintenance : retente dans quelques minutes.`;
}

function describeTimeout(timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  return `L'instance Jira configurée n'a pas répondu en moins de ${seconds} seconde${seconds > 1 ? "s" : ""}. Elle est peut-être surchargée, ou le réseau est lent (VPN, proxy) : retente dans un instant.`;
}

/** Traduit un échec de transport en message, sans jamais citer l'URL ni la cause brute. */
function describeNetworkFailure(error: unknown): string {
  switch (extractSystemErrorCode(error)) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Le domaine de l'instance Jira configurée est introuvable (DNS). Vérifie l'orthographe de l'URL dans les Paramètres, puis la résolution DNS de ce poste.";
    case "ECONNREFUSED":
      return "La connexion à l'instance Jira configurée a été refusée. L'instance est peut-être arrêtée, ou l'accès est filtré depuis ce réseau (VPN, pare-feu d'entreprise).";
    case "ECONNRESET":
    case "EPIPE":
      return "La connexion à l'instance Jira configurée a été interrompue avant la réponse. Retente dans un instant ; si cela persiste, vérifie le proxy ou le VPN de ce poste.";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "L'instance Jira configurée n'est pas joignable depuis ce réseau. Vérifie ta connexion, ou l'accès à l'instance derrière un VPN.";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "Le certificat HTTPS de l'instance Jira configurée n'a pas pu être validé. La connexion a été abandonnée sans envoyer le jeton : vérifie l'URL de l'instance dans les Paramètres.";
    default:
      return "Impossible de joindre l'instance Jira configurée. Vérifie ta connexion réseau (proxy, VPN) et l'URL de l'instance dans les Paramètres.";
  }
}

function describeUnexpectedStatus(status: number): string {
  return `L'instance Jira configurée a répondu avec un statut inattendu (HTTP ${status}). Vérifie que l'URL enregistrée dans les Paramètres désigne bien une instance Jira Cloud.`;
}

function describeRedirect(status: number): string {
  return `L'instance Jira configurée a redirigé la requête (HTTP ${status}). L'URL enregistrée dans les Paramètres ne mène pas directement à l'API : corrige-la, puis retente. Le jeton n'est jamais envoyé à une autre adresse que celle que tu as enregistrée.`;
}

/** Traduit l'échec d'un appel sur le ticket cible (le ticket n'a pas été lu). */
function describeIssueFailure(call: Exclude<JiraCall, { ok: true }>, key: string): string {
  switch (call.kind) {
    case "http_error":
      if (call.status === 401 || call.status === 403) {
        return describeAuthFailure(call.status);
      }
      if (call.status === 404) {
        return `Le ticket « ${key} » est introuvable sur l'instance Jira configurée (HTTP 404). Vérifie la clé du ticket, ou qu'il appartient à un projet que le compte connecté peut lire.`;
      }
      if (call.status >= 300 && call.status < 400) {
        return describeRedirect(call.status);
      }
      return describeUnexpectedStatus(call.status);
    case "rate_limited":
      return describeRateLimited();
    case "server":
      return describeServerFailure(call.status);
    case "timeout":
      return describeTimeout(call.timeoutMs);
    case "network":
      return describeNetworkFailure(call.error);
    case "unusable":
      return MESSAGE_UNUSABLE_RESPONSE;
  }
}

/** Traduit l'échec d'une recherche JQL du périmètre. */
function describeSearchFailure(call: Exclude<JiraCall, { ok: true }>): string {
  switch (call.kind) {
    case "http_error":
      if (call.status === 401 || call.status === 403) {
        return describeAuthFailure(call.status);
      }
      if (call.status === 400) {
        // Une JQL refusée en 400 est presque toujours un écart de configuration d'instance
        // (champ ou syntaxe que cette instance n'accepte pas), pas une faute de l'utilisateur :
        // on ne peut pas lui demander de corriger la requête, mais il doit savoir que le
        // problème vient de la recherche et non de son ticket.
        return "L'instance Jira configurée a refusé la requête de recherche du périmètre (HTTP 400). La recherche dépend de la configuration de l'instance (hiérarchie des tickets, composants) : vérifie cette configuration, ou signale le problème s'il persiste.";
      }
      if (call.status === 404) {
        return "L'instance Jira configurée répond, mais le chemin de recherche de l'API n'y est pas trouvé (HTTP 404). Vérifie que l'URL enregistrée dans les Paramètres est bien l'adresse racine d'une instance Jira Cloud.";
      }
      if (call.status >= 300 && call.status < 400) {
        return describeRedirect(call.status);
      }
      return describeUnexpectedStatus(call.status);
    case "rate_limited":
      return describeRateLimited();
    case "server":
      return describeServerFailure(call.status);
    case "timeout":
      return describeTimeout(call.timeoutMs);
    case "network":
      return describeNetworkFailure(call.error);
    case "unusable":
      return MESSAGE_UNUSABLE_RESPONSE;
  }
}

/* -------------------------------------------------------------------------- */
/* Constructeurs de réponse — champ par champ, jamais par spread                */
/* -------------------------------------------------------------------------- */

function success(method: ScopeMethod, ticketKeys: readonly string[]): ScopeResolution {
  return { status: "success", method, ticketKeys };
}

function failure(message: string): ScopeResolution {
  return { status: "error", message };
}
