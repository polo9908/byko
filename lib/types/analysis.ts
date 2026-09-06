/**
 * ARCHI-4 — Contrat d'API du pipeline d'analyse.
 *
 * Fichier de types purs (aucune valeur exécutable, aucun import runtime) : consommable à
 * l'identique depuis `app/api/` (serveur) et depuis un composant front. Même discipline que
 * `lib/types/settings.ts` (ARCHI-2) : ces types décrivent la FORME des échanges, ils ne
 * valident rien à la frontière — BACK-6 et BACK-7 devront valider les corps de requête
 * entrants, FRONT-8/9/10 devront vérifier la forme des réponses reçues.
 *
 * Ce contrat porte sur deux endpoints :
 * - `POST /api/analysis` (BACK-7) — analyse complète, résultat en streaming (SSE) ;
 * - `GET /api/analysis/scope-count` (BACK-6) — comptage seul, SANS appel IA.
 *
 * Règle de non-invention, appliquée ici sur deux points nommés :
 * - les seuils de `costLevel` (quand « low » / « medium » / « high ») ne sont PAS définis ici.
 *   Ils relèvent de BACK-6 et sont centralisés dans UNE constante (critère d'acceptation,
 *   ligne 100 de `docs/tickets/phase-2-analyse-ticket.md`). Ce contrat ne fournit que le
 *   vocabulaire des trois niveaux ; les inventer ici poserait une règle métier au mauvais
 *   endroit et la dupliquerait ;
 * - la résolution du périmètre de comparaison (Linked Issues → Epic/Component en mode Jira,
 *   champ « Epic / composant » en mode manuel) relève de BACK-5. Ce contrat ne décrit que la
 *   forme des champs qui l'alimentent (`ticketKey`, `scopeHint`), pas l'algorithme.
 *
 * Divergences et décisions assumées avec l'énoncé d'ARCHI-4 : voir
 * `docs/api-contracts.md`, sections `POST /api/analysis` et `GET /api/analysis/scope-count`
 * (numérotées « décision ARCHI-4 n°… »).
 */

/* -------------------------------------------------------------------------- */
/* Vocabulaire partagé                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Source du ticket à analyser : un ticket Jira existant, ou une saisie manuelle.
 * FRONT-7 : « Mode manuel (pas de Jira) : champ texte + champ "Epic / composant" optionnel »
 * (ligne 19 des tickets, phase 2).
 */
export type AnalysisTicketSource = "jira" | "manual";

/**
 * Les 5 paliers fixes de la fenêtre de comparaison, par ancienneté.
 *
 * Règle produit (ligne 10 des tickets, phase 2) : « curseur à 5 paliers fixes
 * (7j / 30j / 90j / 6 mois / 12 mois), pas de valeur continue ». Ce type rend une valeur
 * intermédiaire non représentable : c'est exactement ce que FRONT-8 doit refléter
 * (« slider à 5 crans — jamais de valeur intermédiaire »). C'est aussi le champ sur lequel
 * `scope-count` est rappelé à chaque changement de palier (FRONT-8).
 */
export type ComparisonWindow = "7d" | "30d" | "90d" | "6m" | "12m";

/**
 * Verdict de cohérence, à 3 niveaux (ARCHI-4, ligne 32 des tickets) :
 * `coherent` = Cohérent, `minor_reservations` = Réserves mineures, `breaking_risk` = Cassure
 * risquée.
 *
 * Pourquoi ce type est découplé du flux : FRONT-9 doit pouvoir afficher le verdict dès son
 * arrivée, « sans attendre la fin du flux complet » (critère d'acceptation ARCHI-4, ligne 35).
 * Le verdict est donc le PREMIER événement du flux (`AnalysisVerdictEvent`), et il doit être
 * lisible indépendamment des événements suivants — d'où un type autonome plutôt qu'un champ
 * noyé dans une réponse globale.
 */
export type Verdict = "coherent" | "minor_reservations" | "breaking_risk";

/**
 * Les 3 états d'un composant face au design system (BACK-8, ligne 138) :
 * - `reusable` : score de pertinence fort (Recyclable) ;
 * - `to_verify` : score partiel (À vérifier) ;
 * - `to_create` : aucun résultat pertinent (À créer).
 *
 * Déterminés via l'outil MCP Figma `search_design_system`, « jamais un simple oui/non
 * binaire » (règle produit, ligne 16). Un booléen « existe / n'existe pas » ne peut pas
 * porter la distinction Recyclable / À vérifier, qui est pourtant le cœur de FRONT-10
 * (recycler l'existant plutôt que repartir de zéro).
 */
export type ComponentStatus = "reusable" | "to_verify" | "to_create";

/**
 * Niveau qualitatif de coût, à 3 valeurs, affiché par le badge « N tickets · Coût X »
 * (FRONT-8).
 *
 * La conversion du `count` en niveau est une règle de BACK-6, centralisée dans une seule
 * constante (ligne 100 des tickets : « les seuils Faible/Modéré/Élevé sont centralisés dans
 * une seule constante ») ; la proposition de départ (<10 / 10–30 / >30) est « à définir avec
 * l'équipe » (ligne 94). Ce contrat ne fournit que le vocabulaire des trois niveaux — PAS les
 * seuils. Les fixer ici serait une règle métier inventée au mauvais endroit et dupliquée.
 */
export type CostLevel = "low" | "medium" | "high";

/* -------------------------------------------------------------------------- */
/* POST /api/analysis — requête                                                */
/* -------------------------------------------------------------------------- */

/**
 * Corps de `POST /api/analysis`, union discriminée par `ticketSource`.
 *
 * L'énoncé d'ARCHI-4 (ligne 30) écrit un corps plat à champs optionnels
 * (`ticketKey?`, `ticketText?`) ; le contrat resserre en union discriminée pour qu'un corps
 * incohérent ne soit pas représentable : `ticketSource: "jira"` exige `ticketKey`,
 * `ticketSource: "manual"` exige `ticketText` (décision ARCHI-4 n°1, `docs/api-contracts.md`).
 * Même limite que partout (en-tête de `lib/types/settings.ts`) : ce n'est pas une validation
 * d'entrée, BACK-7 doit valider le corps à la frontière.
 *
 * `scopeHint` est le champ « Epic / composant » du mode manuel (BACK-5, ligne 74 : « utilise
 * uniquement le champ "Epic / composant" saisi à la main s'il est rempli »). Il est déclaré
 * commun aux deux variantes pour symétrie de forme ; en mode Jira, le périmètre est résolu
 * automatiquement (Linked Issues → Epic/Component, BACK-5) et BACK-7 n'en fait pas usage.
 */
export type AnalysisRequest =
  | {
      ticketSource: "jira";
      ticketKey: string;
      comparisonWindow: ComparisonWindow;
      scopeHint?: string;
    }
  | {
      ticketSource: "manual";
      ticketText: string;
      comparisonWindow: ComparisonWindow;
      scopeHint?: string;
    };

/* -------------------------------------------------------------------------- */
/* POST /api/analysis — réponse (flux SSE)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Un composant du design system proposé pour un besoin du ticket (BACK-8).
 *
 * `figmaUrl` est optionnel : le deep-link Figma n'existe que pour `reusable` et `to_verify`
 * (FRONT-10, ligne 288 : « lien Figma pour Recyclable/À vérifier »). Pour `to_create` (aucun
 * résultat pertinent), il n'y a rien à lier — le rendre requis forcerait BACK-8 à fabriquer
 * une URL sans cible (décision ARCHI-4 n°5). Son absence n'est donc pas une panne, c'est la
 * conséquence attendue de l'état.
 */
export interface ComponentRecommendation {
  name: string;
  status: ComponentStatus;
  figmaUrl?: string;
}

/**
 * Premier événement du flux, toujours émis.
 *
 * Pourquoi il est premier : critère d'acceptation d'ARCHI-4 (ligne 35) — « le front peut
 * afficher le verdict dès qu'il arrive, sans attendre la fin du flux complet ». Un flux qui
 * émettrait la traduction avant le verdict obligerait FRONT-9 à buffériser le résultat, ce
 * que le design en streaming interdit. L'ordre est aussi la règle produit (ligne 12) :
 * « verdict → questions de clarification (si besoin) → traduction (toujours affichée) →
 * composants proposés (si Figma connecté) ».
 */
export interface AnalysisVerdictEvent {
  type: "verdict";
  verdict: Verdict;
}

/**
 * Questions de clarification, émis SEULEMENT si le verdict n'est pas `"coherent"`.
 *
 * Règle produit (ligne 14) : le gabarit de questions est « jamais affiché si le verdict est
 * "Cohérent" ». Un flux « cohérent » ne contient donc PAS cet événement — son absence est
 * l'information, et FRONT-9 (ligne 265) affiche la section clarification uniquement si
 * `verdict !== "coherent"`. Le gabarit du message lui-même est défini par ARCHI-5 ; ce contrat
 * ne fournit que le transport : `message` est déjà le texte conforme au gabarit, prêt à être
 * copié ou posté en commentaire Jira.
 */
export interface AnalysisClarificationEvent {
  type: "clarification";
  message: string;
}

/**
 * Traduction en langage clair, TOUJOURS émise, quel que soit le verdict.
 *
 * BACK-7, critère d'acceptation (ligne 122) : « La traduction est toujours présente, quel que
 * soit le verdict ». Contrairement à la clarification, elle ne dépend pas du verdict :
 * `coherent` ou non, le ticket est toujours reformulé en langage clair. C'est la seule
 * section du résultat qui ne soit jamais conditionnelle — d'où « (toujours affichée) » dans la
 * règle produit (ligne 12).
 */
export interface AnalysisTranslationEvent {
  type: "translation";
  text: string;
}

/**
 * Composants proposés, émis au stade composants du flux.
 *
 * `figmaConnected` est explicite et toujours présent : BACK-8 (ligne 140) « sans Figma
 * connecté … renvoie une liste vide avec un flag `figmaConnected: false` explicite ». C'est ce
 * `false`, et non l'absence de l'événement, qui permet à FRONT-10 (ligne 289) d'afficher son
 * message dédié (« Connecte Figma pour voir les composants recommandés ») à la place des
 * cartes — et de ne jamais le confondre visuellement avec « aucun composant trouvé »
 * (critère d'acceptation FRONT-10). Voir la décision ARCHI-4 n°6 sur ce point.
 *
 * Quand `figmaConnected` vaut `false`, `components` est vide : BACK-8 n'a tenté aucun appel
 * MCP Figma (critère d'acceptation BACK-8, ligne 145 : « Sans Figma connecté, aucun appel MCP
 * n'est tenté, réponse immédiate avec le flag »).
 */
export interface AnalysisComponentsEvent {
  type: "components";
  figmaConnected: boolean;
  components: ComponentRecommendation[];
}

/**
 * Échec du pipeline, événement TERMINAL (dernier du flux).
 *
 * Décision ARCHI-4 n°4 (`docs/api-contracts.md`) : l'énoncé d'ARCHI-4 ne liste que 4
 * événements et ne prévoit pas le cas « le provider IA est indisponible / hors quota ». Sans
 * cet événement, une panne du provider serait indistinguable d'un flux silencieusement
 * interrompu — le front ne saurait pas si le résultat est complet ou tronqué. `message` est
 * requis (même motif que partout : FRONT-3/Front-9 affichent le message précis du backend,
 * jamais un texte générique).
 *
 * À ne PAS confondre avec une requête malformée, qui est un `4xx` AVANT le démarrage du flux
 * (voir `docs/api-contracts.md`, convention de codes HTTP). Cet événement, lui, arrive DANS le
 * flux : la requête a abouti (`200`), le pipeline a échoué après coup.
 */
export interface AnalysisErrorEvent {
  type: "error";
  message: string;
}

/**
 * Union discriminée par `type`, dans l'ordre du flux.
 *
 * Ordre attendu : `verdict` (toujours, premier) → `clarification` (optionnel, si verdict ≠
 * `"coherent"`) → `translation` (toujours) → `components` (au stade composants) →
 * `error` (terminal, seulement si le pipeline échoue). Tester `event.type` affine vers la
 * bonne variante sans cast ; l'ordre n'est pas encodé dans le type (un tableau d'événements
 * n'est pas une garantie d'ordre), c'est une obligation de BACK-7, vérifiable en inspectant
 * les événements un par un (critère d'acceptation BACK-7, ligne 123).
 */
export type AnalysisStreamEvent =
  | AnalysisVerdictEvent
  | AnalysisClarificationEvent
  | AnalysisTranslationEvent
  | AnalysisComponentsEvent
  | AnalysisErrorEvent;

/* -------------------------------------------------------------------------- */
/* GET /api/analysis/scope-count — requête                                     */
/* -------------------------------------------------------------------------- */

/**
 * Paramètres de requête de `GET /api/analysis/scope-count` (BACK-6).
 *
 * L'énoncé d'ARCHI-4 (ligne 31) écrit `{ ticketKey, comparisonWindow }` ; le contrat ajoute
 * `scopeHint?` et rend `ticketKey?` optionnel (décision ARCHI-4 n°2), parce que BACK-6
 * « réutilis[e] la résolution de périmètre de BACK-5 » (ligne 93), qui couvre le mode manuel :
 * pas de `ticketKey`, un champ « Epic / composant » = `scopeHint`. En mode Jira, `ticketKey`
 * est renseigné ; en mode manuel, c'est `scopeHint` qui l'est. `comparisonWindow` est
 * toujours requis : c'est le palier choisi sur le curseur (FRONT-8, ligne 243), rappelé à
 * chaque changement de cran.
 *
 * Aucun appel IA n'est déclenché par cet endpoint (critère d'acceptation BACK-6, ligne 99, et
 * ARCHI-4, ligne 36 : « moins d'une seconde perçue ») : `ScopeCountParams` ne porte que des
 * champs de résolution de périmètre, aucun prompt ni paramètre d'inférence.
 */
export interface ScopeCountParams {
  ticketKey?: string;
  scopeHint?: string;
  comparisonWindow: ComparisonWindow;
}

/* -------------------------------------------------------------------------- */
/* GET /api/analysis/scope-count — réponse                                     */
/* -------------------------------------------------------------------------- */

/**
 * Réponse de `GET /api/analysis/scope-count`, enveloppée par `status`.
 *
 * L'énoncé d'ARCHI-4 (ligne 31) écrit `{ count, costLevel }` nu ; le contrat aligne sur la
 * convention du projet (décision ARCHI-4 n°3) : `status: "success" | "error"`, `message`
 * requis en erreur. Sans variante d'erreur, un échec de résolution du périmètre (Jira non
 * connecté, instance injoignable) serait indistinguable d'un « 0 ticket » — et le badge
 * « 0 tickets · Coût faible » mentirait.
 *
 * La conversion de `count` en `costLevel` est faite par BACK-6, pas par le front : les seuils
 * sont centralisés côté serveur (ligne 100). `count` est le « comptage réel » de tickets dans
 * la fenêtre (ligne 11), jamais une estimation forfaitaire par palier.
 *
 * Conformément à la convention de codes HTTP du projet, un échec applicatif RATTRAPÉ répond
 * `200` avec `status: "error"` — pas de `4xx` pour un échec métier. Le `4xx` est réservé aux
 * requêtes malformées (ex. `comparisonWindow` hors des 5 paliers).
 */
export type ScopeCountResponse =
  | { status: "success"; count: number; costLevel: CostLevel }
  | { status: "error"; message: string };
