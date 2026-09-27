# Contrat — Automatisation navigateur (extension Chrome + canal natif)

> **Document d'étude, rédigé le 27/09/2026. Rien n'est implémenté, rien n'est figé.**
> À cette date, le dépôt ne contient ni extension, ni helper de messagerie native, ni canal
> IPC d'automatisation. Ce document décrit une cible, pas un état.
>
> Il est destiné au **dépôt public** (`docs/ipc/` n'est pas dans `.gitignore`) : il ne doit
> contenir aucun secret, aucun identifiant de développement, aucune URL privée.

## 1. Pourquoi

Pour brancher Google Agenda, l'utilisateur traverse aujourd'hui cinq pages de Google Cloud
Console — `createProject`, `enableApi`, `consentScreen`, `testUsers`, `createClient` (voir
`src/main/connectors/setup-pages.ts` et le type `GoogleCalendarSetupPage`) — puis recopie un
Client ID et un Client Secret dans BYKO. L'assistant intégré
(`GoogleCalendarSetupWizard`) guide chaque étape avec un bouton « Ouvrir ↗ », mais ne clique
jamais à la place de l'utilisateur.

Demande : une **extension Chrome reliée à BYKO** qui pilote le navigateur de l'utilisateur —
ouvrir Cloud Console, cliquer les pages et les boutons, remplir les champs, créer l'API et
l'identifiant OAuth — puis pousser les identifiants dans BYKO. Objectif déclaré : que
l'utilisateur n'ait plus rien à faire à la main.

### Ce qui est automatisable, et ce qui ne l'est pas

| Catégorie | Verdict |
|---|---|
| Cliquer et saisir dans les pages d'une session **déjà authentifiée** du navigateur de l'utilisateur | **Oui** — c'est le périmètre de ce document |
| **Créer un compte** (Google, Atlassian, Figma) | **Non** — CAPTCHA, vérification téléphonique, conditions d'utilisation qui l'interdisent. Aucune version de cette fonctionnalité ne crée de compte |
| **Consentement OAuth final** (écran « Autoriser » de Google) | **Techniquement possible, volontairement exclu** — voir §3 |
| Créer un client OAuth « Application de bureau » par API | **Non** — l'API IAM en expose une qui y ressemble, mais n'accepte aucun scope d'API Google (§7.4) |

## 2. Périmètre

**Dans le périmètre**

- Une extension Chrome qui n'agit que sur une **liste blanche d'origines**, par recettes
  déclaratives.
- Un canal de messagerie native entre l'extension et BYKO.
- Le clic « Connecter » de chaque fiche de connecteur, qui vaut déclenchement (§3.5).
- **Les recettes de tous les connecteurs branchés** — Google Agenda, Jira, Figma, et chaque
  fournisseur IA (§5.2). Google Agenda n'est que la première : c'est la plus longue, donc la
  plus démonstrative.

**Hors périmètre**

- Toute création de compte.
- L'automatisation de l'écran de consentement OAuth.
- Le pilotage libre par un modèle de langage (voir §3.3).
- Safari et Firefox — chacun demanderait sa propre extension.
- Toute page hors liste blanche. Toute URL fournie par le renderer.
- Les connecteurs sans backend (Slack aujourd'hui, voir §7.1 ; Teams, Outlook, GitHub).

## 3. Décisions

### 3.1 Arbitré par l'utilisateur le 27/09/2026 — l'écran « Autoriser » reste humain

L'extension exécute toutes les étapes de Cloud Console et pousse les identifiants dans BYKO,
puis **s'arrête** sur l'écran de consentement Google en affichant une consigne. L'utilisateur
clique « Autoriser » lui-même.

**Motif** : un programme qui approuve des scopes OAuth à la place de l'utilisateur est le
motif signature d'une extension malveillante. Google le combat activement, et le compte mis
en cause serait celui de **l'utilisateur**, pas celui de BYKO. C'est également le seul point
du flux où le consentement a une valeur juridique.

Conséquence de conception : la recette se termine par une étape `pause` explicite (§5), et
non par un échec.

### 3.2 Arbitré par l'utilisateur le 27/09/2026 — aucune création de compte

L'extension suppose une session déjà ouverte dans le navigateur. Elle ne remplit aucun
formulaire d'inscription.

**Motif** : infaisable de façon fiable (CAPTCHA, vérification téléphonique) et contraire aux
conditions d'utilisation des fournisseurs concernés.

### 3.3 Arbitré par l'utilisateur le 27/09/2026 — recettes figées, pas de pilotage par IA

**Retenu : des recettes déterministes** (origine autorisée + liste ordonnée d'étapes), et non le
pilotage « à la Claude » où un modèle regarde la page et décide chaque clic.

**Motifs** : non-déterminisme (une même recette doit produire le même résultat à chaque fois) ;
auditabilité (`CLAUDE.md` impose `qa-log-auditor` sur les zones sensibles, or une décision prise
par un modèle à chaque clic n'est pas relisible) ; et fuite du contenu de pages contenant des
identifiants vers un fournisseur d'IA tiers.

**Précision du 27/09/2026 — l'IA n'intervient qu'en réparation, jamais au vol.** Le pilotage à
l'exécution reste écarté, mais une aide est prévue : quand un sélecteur cesse de correspondre,
l'IA propose le sélecteur corrigé à partir de la structure de la page, un humain le valide, et il
est commité. Aucun appel d'IA n'a lieu sur la machine de l'utilisateur, aucun jeton n'est dépensé
à l'usage, et la recette livrée reste déterministe et relisible.

Deux raisons, dans l'ordre d'importance :

1. **Les pages automatisées affichent les secrets qu'on récupère** — le Client Secret, le jeton
   Atlassian, le jeton Figma. Une IA qui « regarde » ces pages enverrait ces secrets à un
   fournisseur tiers, sur l'écran même où ils naissent.
2. Un pilotage à l'exécution n'est ni reproductible ni auditable, alors que `CLAUDE.md` impose un
   audit des zones sensibles.

Un repli d'IA à l'exécution — sur structure de page assainie, et seulement pour les étapes qui ne
touchent à aucun secret — reste une option ouverte, à construire plus tard si les recettes se
révèlent pénibles à maintenir. Ce filtre d'assainissement serait alors du code critique, testé
comme tel : un DOM porte des valeurs dans ses attributs, et une seule erreur de filtre est une
fuite.

### 3.4 Posé par l'utilisateur le 27/09/2026 — le minimum de clavier et de souris

Le but de BYKO est que l'utilisateur touche le moins possible au clavier et à la souris. Une
automatisation qui ne remplacerait qu'une partie des clics — parce qu'elle réclame une
confirmation à chaque étape — raterait la cible. Le parcours visé est donc : **l'utilisateur ne
fait rien, sauf ce qui ne peut pas être fait autrement.**

Les seules actions humaines qui subsistent, et la raison de chacune :

| Action humaine restante | Pourquoi elle est incompressible | Fréquence |
|---|---|---|
| Ouvrir Chrome | aucun processus externe ne peut réveiller un service worker endormi (§4.2) | si le navigateur est fermé |
| Installer l'extension et accepter ses permissions | imposé par Chrome ; l'extension est le seul moyen d'agir dans le navigateur | une fois |
| Être déjà connecté à son compte Google | l'extension ne saisit jamais de mot de passe | une fois |
| Choisir le compte, si plusieurs sont connectés | Google impose ce choix | si ambigu |
| reCAPTCHA éventuel à la création du projet | anti-robot de Google | imprévisible |
| Écran « Autoriser » du consentement OAuth | décision §3.1 | une fois par connexion |
| Écran « Google n'a pas validé cette application » → « Paramètres avancés » → « Accéder à … » | Google l'affiche pour toute application en mode Test — c'est le cas de tout client créé par ce parcours | une fois par connexion |

**Tout le reste** — ouvrir les pages, cliquer, remplir les champs, créer le projet, activer
l'API, créer le client OAuth, lire les identifiants, les enregistrer, puis enchaîner
l'autorisation — s'exécute sans intervention, et **sans retour à BYKO** entre les étapes.

### 3.5 Arbitré par l'utilisateur le 27/09/2026 — aucun écran de consentement

**Retenu : le clic sur « Connecter » vaut consentement.** Aucun écran d'acceptation n'intercepte
le démarrage ; l'automatisation part aussitôt, et le navigateur s'ouvre sous les yeux de
l'utilisateur, qui voit donc ce qui se passe. Mise en œuvre directe du principe §3.4 : pas un
clic de plus.

Ce qui protège malgré tout l'utilisateur, sans rien lui demander :

- la liste des actions prévues reste **affichée en clair** dans BYKO pendant l'exécution (§4.3,
  étape 2) — informative, pas bloquante ;
- un bouton **Arrêter** reste disponible à tout moment ;
- l'extension n'agit que sur les origines déclarées par la recette (§5.3), jamais ailleurs ;
- les actions irréversibles côté Google restent derrière les écrans que Google impose lui-même
  (§3.4).

**Écarté** : l'interrupteur global dans Réglages (un passage supplémentaire au premier usage) et
l'écran d'acceptation à chaque connexion (un clic de plus à chaque fois, contraire à §3.4).

## 4. Architecture

### 4.1 Une quatrième surface

`CLAUDE.md` décrit trois surfaces (`main` / `preload` / `renderer`) et une frontière de
sécurité stricte entre elles. Ce chantier en ajoute une quatrième — **l'extension** — qui vit
hors de l'application, dans un processus que BYKO ne contrôle pas :

```
   Chrome (processus de l'utilisateur)
   ┌──────────────────────────────────────┐
   │  extension                            │
   │    ├─ service worker                  │  lit la page, exécute les étapes
   │    └─ content script (origines WL)    │
   └───────────────┬──────────────────────┘
                   │  native messaging (stdin/stdout, pas de port en écoute)
                   ▼
   BYKO
   ┌──────────────────────────────────────┐
   │  main      recettes, état, validation │
   │    │       du secret, safeStorage     │
   │  preload   surface minimale           │
   │  renderer  affiche l'étape N/M, Stop  │
   └──────────────────────────────────────┘
```

Le renderer ne voit ni l'extension, ni le canal natif : il ne connaît qu'un identifiant de
recette et une progression.

### 4.2 Le pont : messagerie native

Retenu : `chrome.runtime.connectNative()`, **pas** un serveur localhost. Chrome lance lui-même
le processus hôte et communique par `stdin`/`stdout` ; aucun port n'est ouvert, donc aucun
autre onglet ni programme local ne peut s'y connecter.

Vérifié sur la documentation Chrome (27/09/2026) :

- Le manifeste hôte se dépose, sur macOS par utilisateur, dans
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<nom>.json` (et
  `~/.config/google-chrome/NativeMessagingHosts/` sous Linux). Le champ `path` doit être un
  chemin absolu.
- `allowed_origins` liste les extensions autorisées et **n'accepte pas de joker**. Une origine
  absente de la liste reçoit « Access to the specified native messaging host is forbidden ».
- Taille maximale d'un message : **1 Mo** de l'hôte vers Chrome, **64 Mio** de Chrome vers
  l'hôte. Les recettes et les identifiants sont loin de ces limites, mais la remontée d'une
  page entière ne tiendrait pas dans le premier.
- La permission `nativeMessaging` est obligatoire, et ces méthodes ne sont **pas** disponibles
  dans un content script — seulement dans les pages de l'extension et son service worker.

**Qui parle en premier.** Vérifié le 27/09/2026 : un port `connectNative()` **maintient le
service worker de l'extension en vie** (Chrome 105 et suivants) ; si le processus hôte meurt, le
port se ferme et le service worker s'arrête — il faut donc se reconnecter dans le gestionnaire
`onDisconnect`. Le corollaire est plus contraignant : **aucun processus externe ne peut réveiller
un service worker endormi**, et la documentation ne décrit l'amorçage que dans le sens
extension → hôte. C'est donc **l'extension qui doit ouvrir le port** — au démarrage du profil
(`onStartup`) et à l'installation (`onInstalled`) — puis le garder ouvert ; BYKO ne peut que
répondre. Conséquence directe sur l'UX : si Chrome n'est pas lancé, ou si l'extension n'est pas
connectée, BYKO ne peut rien déclencher. C'est l'une des actions humaines incompressibles de
§3.4.

### 4.3 Cycle complet d'un « Créer automatiquement »

1. L'utilisateur ouvre la fiche du connecteur (Google Agenda) et clique « Connecter » — ce clic
   vaut consentement (§3.5), il n'y a pas d'écran intermédiaire à valider.
2. Le renderer affiche immédiatement la progression : la liste des actions prévues, étape par
   étape (« créer un projet Cloud nommé … », « activer l'API Calendar », …), et un bouton
   Arrêter. Cette liste est **informative, pas une demande d'accord**.
3. Le renderer appelle un canal IPC en envoyant **un identifiant de recette** — jamais une URL,
   jamais un sélecteur, jamais un script.
4. `main` valide l'identifiant contre la liste blanche, prend la main sur l'état, et transmet
   la recette à l'extension par le canal natif.
5. L'extension ouvre les pages, exécute les étapes dans l'ordre, et remonte après chaque
   étape un statut (`ok`, `échec` + description, `en attente d'humain`).
6. `main` relaie la progression au renderer (numéro d'étape, libellé, état). L'utilisateur voit
   où en est l'automatisation et peut l'arrêter à tout moment.
7. À l'étape de lecture des identifiants, l'extension remonte le Client ID et le Client Secret.
   `main` **valide leur forme** (mêmes règles que `docs/ipc/google-calendar-credentials.md` :
   Client ID terminé par `.apps.googleusercontent.com`, secret non vide sans espace interne,
   longueur ≤ 256) puis persiste via `src/main/secrets.ts` (`safeStorage`).
8. La recette atteint l'étape `pause` : BYKO affiche « Cliquez sur Autoriser dans votre
   navigateur », puis enchaîne sur le flux OAuth existant (boucle locale + PKCE).
9. Le renderer n'a jamais vu le secret : il ne reçoit qu'un statut (« identifiants
   enregistrés ») et la progression.

### 4.4 Canaux IPC envisagés

Formes indicatives, à figer en phase ②.

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `browserAutomation:availability` | `browserAutomation.availability()` | — | extension présente et appariée ? |
| `browserAutomation:start` | `browserAutomation.start(recipeId)` | identifiant de recette | `void` ou rejet |
| `browserAutomation:cancel` | `browserAutomation.cancel()` | — | `void` |
| `browserAutomation:status` | `browserAutomation.getStatus()` | — | étape courante, total, état |
| `browserAutomation:onProgress` | abonnement | — | événement de progression |

**Aucun de ces canaux ne transporte de secret vers le renderer.** Le seul canal porteur
d'identifiants va de l'extension vers `main`, dans l'autre sens, hors de la portée du
renderer.

## 5. Contrat de recette

### 5.1 Forme

Les recettes vivent dans `src/main/` — même principe que `SETUP_PAGE_URLS` dans
`src/main/connectors/setup-pages.ts` : une seule source, côté main, jamais transmise au
renderer.

```ts
interface AutomationRecipe {
  id: AutomationRecipeId
  connector: ConnectableConnectorId
  origins: readonly string[]          // liste blanche d'origines pour cette recette
  steps: readonly RecipeStep[]
}

type RecipeStep =
  | { action: "open";    page: AutomationPageId; description: string }
  | { action: "click";   selector: string; description: string }
  | { action: "fill";    selector: string; value: FillValue; description: string }
  | { action: "waitFor"; selector: string; timeoutMs: number; description: string }
  | { action: "read";    selector: string; capture: CaptureKey; description: string }
  | { action: "pause";   reason: "humanConsent"; description: string }
```

`FillValue` couvre trois cas : une constante (le nom du produit), une valeur fournie par
l'utilisateur (le nom du projet), et une valeur générée localement (un identifiant de projet
unique). `CaptureKey` nomme ce que l'étape `read` ramasse — voir §5.2 : ces clés sont celles
des connecteurs, pas seulement celles de Google.

### 5.2 Un modèle générique, pas un modèle Google

**Exigence posée par l'utilisateur le 27/09/2026 : la connexion automatique doit valoir pour
tous les connecteurs**, pas seulement Google Agenda.

Conséquence de conception : la chaîne « capture → validation → enregistrement » est
**générique**. Chaque recette déclare ce qu'elle produit, et `main` remet ces valeurs à la
fonction `connect` **existante** du connecteur concerné. Rien ne doit être écrit en supposant
Google : ni un type `clientSecret` en dur, ni un appel direct à `google-calendar.ts`, ni une
page d'identifiants supposée être celle de Cloud Console.

État des lieux des connecteurs branchés (`src/shared/connectors.ts`) :

| Connecteur | Ce que la recette doit produire | Entrées non secrètes |
|---|---|---|
| Google Agenda | Client ID, Client Secret | nom du projet Cloud (généré) |
| Jira | jeton d'API | e-mail du compte ; le domaine est déductible par l'heuristique existante `guessJiraDomain()` (`src/shared/jira.ts`) |
| Figma | jeton personnel | — |
| IA | clé d'API | **une recette par fournisseur** : le registre `AI_PROVIDERS` en compte six (`src/shared/ai.ts`), chacun avec sa page de clé et sa variable d'environnement de détection |

Les connecteurs annoncés mais sans backend (Slack, Teams, Outlook, GitHub) restent hors
périmètre tant que leur intégration n'existe pas : une recette n'aurait rien à alimenter.

### 5.3 Règles

- **Les recettes vivent dans `main`.** Le renderer n'envoie qu'un identifiant, validé contre
  une liste blanche — prolongement direct de la règle « aucune URL dans le renderer ».
- **Une recette ne peut agir que sur les origines de son champ `origins`.** Aucune recette ne
  reçoit d'origine dynamique.
- **Chaque étape porte une `description` en français**, affichée telle quelle dans la
  progression. Une étape sans description lisible n'est pas publiable : l'utilisateur doit
  pouvoir comprendre ce qui se passe et arrêter en connaissance de cause.
- **`pause` n'est pas un échec.** C'est le mécanisme par lequel le consentement Google reste
  humain (§3.1).
- **Toute étape a un délai.** Un sélecteur qui n'apparaît pas dans le délai fait échouer la
  recette avec le libellé de l'étape, pas un message générique.
- **Aucun secret partiel.** Un échec en cours de recette ne doit jamais laisser un identifiant
  à moitié écrit dans `secrets.json` ; l'écriture suit les règles existantes du dépôt, et le
  chantier déjà identifié sur l'écriture non atomique de `secrets.json` devient plus urgent,
  pas moins.
- **Reprise.** Un utilisateur peut interrompre au milieu. Une recette doit pouvoir constater
  qu'un projet existe déjà et reprendre à l'étape suivante, plutôt que de créer un doublon.
- **Selectors.** Les sélecteurs de Cloud Console ne sont ni documentés ni stables. Chaque
  recette doit privilégier les attributs d'accessibilité et les libellés visibles plutôt que
  des classes générées, et être accompagnée d'une procédure de test manuel — c'est le point
  qui cassera le plus souvent.

## 6. Modèle de menace

Ce chantier ajoute une voie d'entrée de secrets dans l'application. C'est, au sens de
`CLAUDE.md`, une **zone sensible** : `qa-log-auditor` passe à chaque changement, pas en fin de
lot.

| Risque | Traitement |
|---|---|
| L'extension est un nouveau porteur du Client Secret | L'identifiant d'extension est l'ancre de confiance : `allowed_origins` (sans joker) le fige. L'identifiant doit être **stable** (clé publique épinglée), sinon l'appariement casse à chaque rechargement |
| Le secret lu dans le DOM pourrait être altéré par la page | Le secret est validé par `main` sur sa forme avant écriture. Un secret de forme valide mais faux échoue de toute façon à la pré-vérification `invalid_client` déjà en place dans `connectWithCredentials` |
| Une autre extension ou un autre onglet lit la même page | Réel, mais **le risque existe déjà aujourd'hui** : l'utilisateur copie ce secret depuis la même page. L'automatisation ne l'aggrave pas ; elle ne le réduit pas non plus |
| Le helper natif est un exécutable que Chrome lance | Binaire signé et notarisé sur macOS. **Aucun argument reçu de l'extension ne devient un chemin de fichier ou une commande** — même règle que pour les canaux IPC existants |
| Journalisation | Aucun `console.*` contenant identifiants, jetons, ni corps de page. Les journaux ne portent que des libellés d'étape et des états |
| Le renderer devient un vecteur | Inchangé : il envoie un identifiant de recette, il reçoit un statut. Il ne peut pas injecter de sélecteur ni d'URL |

## 7. Alternatives et arbitrages

### 7.1 Flux par manifeste — à privilégier quand il existe

Pour un fournisseur qui propose un protocole officiel de création d'application, l'automatiser
par le DOM est le mauvais choix : fragile, et inutilement intrusif.

- **Slack** — vérifié le 27/09/2026 : `https://api.slack.com/apps?new_app=1&manifest_json=<manifeste URL-encodé>`
  (ou `manifest_yaml`) ouvre directement la création depuis un manifeste ; l'utilisateur clique
  « Next » puis « Create ». Pas de scraping. Un second mécanisme existe (`apps.manifest.create`)
  mais suppose un *app configuration access token* généré depuis la page de l'app — donc
  inutilisable pour une première création.
- **GitHub** — vérifié le 27/09/2026 : l'*App manifest flow* POSTe le manifeste sur
  `/settings/apps/new`, l'utilisateur clique « Create GitHub App », GitHub redirige vers
  `redirect_url` avec un `code` temporaire, que l'app échange via
  `POST /app-manifests/{code}/conversions` contre l'identifiant, la clé privée et le secret de
  webhook. Les trois étapes doivent être bouclées en une heure.

Ces deux flux supposent un backend côté BYKO pour consommer le résultat : Slack (E3) n'est pas
commencé et GitHub (D2) n'a pas d'intégration. Ils ne sont donc pas disponibles avant.

### 7.2 `gcloud` en CLI pour les étapes 1-2

Vérifié : `gcloud services enable calendar-json.googleapis.com` et `gcloud projects create`
(qui n'exige pas de compte de facturation). Cela couvrirait la création de projet et
l'activation de l'API **sans navigateur et sans CAPTCHA**. En échange, il faut que
l'utilisateur installe et authentifie `gcloud` — un prérequis plus lourd que l'extension pour
la plupart des utilisateurs. À considérer comme repli pour les utilisateurs techniques.

### 7.3 Client OAuth porté par BYKO + relais

C'est la seule option qui **supprime** le problème au lieu de le masquer. Elle a été écartée le
27/09/2026 parce qu'un client partagé impose un mode Test limité à 100 utilisateurs et une
procédure de vérification Google. Une extension ne change pas ce calcul : elle rend le coût
invisible pour l'utilisateur, elle ne le fait pas disparaître. Ce choix reste réversible.

### 7.4 Piste testée puis écartée — l'API IAM expose une ressource `oauthClients`

Constat du 27/09/2026 : l'API IAM v1 expose
`projects.locations.oauthClients` avec un `create`
(`POST https://iam.googleapis.com/v1/{parent=projects/*/locations/*}/oauthClients`), et le type
`OauthClient` porte des champs qui ressemblent à ce dont un client public a besoin :
`clientType` (`PUBLIC_CLIENT` « Public client has no secret. » / `CONFIDENTIAL_CLIENT`),
`allowedGrantTypes` (`AUTHORIZATION_CODE_GRANT`, `REFRESH_TOKEN_GRANT`), `allowedRedirectUris`,
`allowedScopes`.

**Mais** la ressource est documentée comme servant à « access Google Cloud resources on behalf
of a Workforce Identity Federation user ».

**Verdict du 27/09/2026 : piste écartée.** La commande `gcloud iam oauth-clients create` existe
bien et n'exige ni *workforce pool* ni fournisseur d'identité — mais elle **restreint les valeurs
acceptées** à une énumération fermée :

- `--allowed-scopes` : `https://www.googleapis.com/auth/cloud-platform`, `openid`, `email`,
  `groups` — **et rien d'autre** ;
- `--allowed-grant-types` : `authorization-code-grant`, `refresh-token-grant` ;
- `--client-type` : `confidential-client`, `public-client`.

**Aucun scope d'API Google grand public n'y figure** — ni Agenda, ni Gmail, ni Drive. Un client
créé par cette API ne peut donc pas demander l'accès à l'agenda de l'utilisateur, qui est
exactement le besoin. L'énumération confirme la description de la ressource : ce mécanisme sert à
obtenir un jeton pour agir sur des ressources **Google Cloud** au nom d'un utilisateur fédéré,
pas à fabriquer un client OAuth « Application de bureau » pour les API publiques Google.

**Conséquence : l'étape 5 reste irréductiblement une interaction navigateur.** Le seul bénéfice
qu'aurait apporté cette API — supprimer la recette Google entière — n'est pas disponible.

Deux réserves, par honnêteté : ce test est **documentaire, non exécuté** (voir §10), et le schéma
REST type `allowedScopes` en `[string]`, donc la seule lecture ne permet pas d'exclure que le
service accepte une valeur hors de la liste du CLI. Un test vivant lèverait ces réserves ; il ne
changerait pas la conclusion probable.

## 8. Distribution

- **Dev** : extension chargée non empaquetée, mode développeur Chrome. L'installeur BYKO (ou
  un script) dépose le manifeste hôte au chemin vérifié en §4.2. Comme `allowed_origins` fige
  l'identifiant de l'extension, il faut épingler une clé publique dans le manifeste de
  l'extension pour que l'identifiant ne change pas entre deux chargements.
- **Production** : Chrome Web Store. Une extension qui automatise des consoles tierces a un
  risque réel de refus à la revue. À trancher avant toute distribution à des tiers.
- **Plateformes** : Chrome uniquement au départ. Safari et Firefox demanderaient chacun une
  extension distincte.
- **macOS** : le helper natif doit être signé et notarisé, sinon Gatekeeper bloque son
  lancement par Chrome.

## 9. Phasage

| Phase | Contenu | Critère de fin |
|---|---|---|
| ① | Ce document | Relu et arbitré, y compris §3.3 (recettes figées ou IA) |
| ② | Le pont seul : extension squelette, manifeste hôte, appariement, un aller-retour de test. **Aucune recette, aucune donnée réelle** | Un message part de l'extension et revient au main, tracé, sans secret |
| ③ | La **chaîne générique** de capture — recette → capture → validation → `connect` du connecteur — puis la première recette, Google Agenda (5 pages) avec son étape `pause` | Les identifiants arrivent dans `safeStorage` par la chaîne générique, et le flux OAuth existant s'enchaîne ; audit `qa-log-auditor` passé |
| ④ | Les recettes des autres connecteurs branchés — Jira, Figma, et les six fournisseurs IA — **sans retoucher la chaîne générique de ③** | Chaque connecteur se configure de bout en bout. Si une recette oblige à modifier la chaîne de ③, c'est que ③ n'était pas générique |
| ⑤ | Slack, **après E3** (le backend n'existe pas) — via manifeste, pas via DOM | Le token Slack est consommé par une intégration réelle |

## 10. Questions ouvertes et points non vérifiés

**À trancher**

1. Accepte-t-on le risque de suspension du compte Google de l'utilisateur ? Piloter
   `console.cloud.google.com` par script contrevient aux conditions d'utilisation de Google
   Cloud. C'est le risque assumé de ce chantier, et il porte sur le compte de l'utilisateur.
2. Faut-il exécuter le test vivant de §7.4 pour lever les deux réserves, ou la conclusion
   documentaire suffit-elle à écarter définitivement la piste ?

**Non vérifié à ce jour**

- **§7.4 a été tranché par la documentation, pas par un appel réel.** `gcloud` n'est pas
  installé sur la machine de développement (constaté le 27/09/2026), donc ni
  `gcloud iam oauth-clients create` ni les commandes de §7.2 n'ont été exécutées. Un test vivant
  demanderait d'installer `gcloud`, de s'authentifier, et de créer une ressource réelle dans un
  projet Google Cloud.
- `gcloud projects create` : commande et syntaxe lues dans la référence, **non exécutée** sur
  cette machine.
- Le comportement de Chrome vis-à-vis d'un manifeste hôte déposé alors que Chrome tourne déjà
  (faut-il redémarrer le navigateur ?) — non trouvé dans la documentation consultée.
- L'existence d'un mécanisme d'installation automatique du manifeste hôte par un installeur
  d'application, sur macOS et sur Windows — non vérifiée.
- Le risque de refus en revue Chrome Web Store pour ce type d'extension — évalué par
  analogie, aucune source consultée.
- Le comportement de Cloud Console face à l'automatisation (reCAPTCHA sur la création de
  projet, détection de script) : réel mais non mesuré.

## 11. État d'implémentation — phase ② (27/09/2026)

| Élément | Fichier |
|---|---|
| Types du pont, nom du manifeste hôte | `src/shared/browserAutomation.ts` |
| Chemin du socket — source unique pour main et helper | `src/main/browser-automation/socket-path.ts` |
| Extrémité BYKO : serveur local, état, mesure de l'aller-retour | `src/main/browser-automation/bridge.ts` |
| Helper lancé par Chrome | `src/native-host/index.ts` |
| Cadre de messagerie native (en-tête 32 bits + JSON) | `src/native-host/native-protocol.ts` |
| Extension (MV3, permission `nativeMessaging` seule) | `browser-extension/` |
| Installeur du manifeste hôte | `scripts/install-native-host.mjs`, via `npm run install:native-host` |

Choix d'implémentation à retenir :

- **Ni le renderer ni le preload n'ont été touchés.** La phase ② n'a aucun besoin d'interface, et
  `CLAUDE.md` interdit d'exposer une fonction sans consommateur réel. Le canal
  `browserAutomation:start` de §4.4 viendra avec la première recette.
- **Le helper tourne sur le binaire Electron du projet** (`ELECTRON_RUN_AS_NODE=1`) : aucun Node
  système n'est requis. La distribution demandera un exécutable dédié, signé et notarisé.
- **Le socket est créé en `0600`** dans `~/Library/Application Support/BYKO/`. La variable
  d'environnement `BYKO_BROWSER_AUTOMATION_SOCKET` permet de le déplacer (test isolé, instance
  parallèle) ; elle n'est jamais alimentée par le renderer.
- **L'extension ne déclare aucune permission d'hôte** : en l'état, elle est techniquement
  incapable de lire une page.
- **Windows est écarté de cette phase** : le manifeste hôte devrait y pointer vers un exécutable
  natif, pas un script shell.

Vérifié le 27/09/2026 : `typecheck`, `lint` et `build` passent ; le helper a été testé seul
contre un serveur factice, messages entiers *et* messages découpés en morceaux ; le pont a été
testé contre l'application réelle lancée sur un profil isolé — socket en `0600`, ping reçu,
aller-retour confirmé en 2 ms.

**Trajet complet vérifié le 27/09/2026, avec Chrome.** L'extension chargée dans Chrome s'est
reconnectée toute seule au pont au lancement de BYKO (≈2 s), aller-retour confirmé en 1 ms :
extension → messagerie native → lanceur → helper → socket local → main, puis retour. À noter, un
premier essai avait échoué : le pont n'accepte **qu'un interlocuteur à la fois**, et l'extension
réelle tenait déjà la connexion — c'est le comportement voulu, pas une panne.

Restent non vérifiés : la reconnexion après un redémarrage complet de Chrome (mécanisme
`onStartup`), et Windows, écarté de cette phase.

**Audit QA non passé** : `qa-log-auditor` est défini avec `model: opus`, indisponible dans
l'environnement actuel (même cause que l'échec de l'orchestrateur). Le pont est une zone
sensible au sens de `CLAUDE.md` — nouvel accès système, nouveau processus, nouvel identifiant
d'extension comme ancre de confiance — donc l'audit reste dû.

## 12. Phase ③ — état au 27/09/2026

La phase ③ se décompose en quatre morceaux, dont un seul est fait :

| Morceau | Fichiers | État |
|---|---|---|
| La chaîne de capture générique | `shared/browserAutomation.ts` (modèle de recette + protocole), `main/browser-automation/runner.ts` (machine à états), `main/browser-automation/apply.ts` (couture vers les intégrations) | **Fait.** Testé hors application par 22 assertions : démarrage, progression, captures complètes et incomplètes, échecs, refus du connecteur, annulation, expiration, non-fuite des valeurs dans les journaux |
| L'exécuteur côté extension | content script + permissions d'hôte | **Non commencé.** Chaque modification de l'extension demande un rechargement manuel dans `chrome://extensions`, donc cette partie n'est pas vérifiable depuis l'atelier |
| La recette Google Agenda | recette + pages | **Non commencée** — bloquée sur l'obtention des sélecteurs réels (voir §13) |
| Le déclencheur | IPC, preload, bouton « Connecter », affichage de la progression | **Non commencé.** Volontairement reporté : sans recette à déclencher, il n'y aurait rien à exposer |

`apply.ts` est délibérément le seul fichier qui connaisse les connecteurs : ajouter Jira ou Figma
consiste à y ajouter un cas, sans toucher à l'exécution des recettes. Les connecteurs qui n'ont
pas encore de chaîne lèvent une erreur explicite plutôt que de faire semblant.

## 13. Où vivent les sélecteurs — et pourquoi c'est un problème

Aucune des pages à automatiser n'est accessible sans une session authentifiée (Cloud Console,
Atlassian, Figma, les consoles IA). Leur DOM ne peut donc pas être lu depuis l'atelier, et des
sélecteurs inventés produiraient une recette qui ne fonctionne pas. Trois voies ont été
examinées :

- **Piloter le Chrome de l'utilisateur.** Écarté : l'IA navigateur de Qwen n'est pas configurée
  dans cet environnement, et surtout **Chrome refuse le débogage distant sur un profil par
  défaut** — « *from Chrome 136 … switches will no longer be respected if attempting to debug
  the default Chrome data directory* ». C'est une protection délibérée : aucun outil externe ne
  doit s'emparer des sessions de l'utilisateur. Playwright tombe sous le coup de cette règle,
  et une extension MV3 ne peut de toute façon pas exécuter Playwright.
- **Relever les sélecteurs à la main**, dans une session dédiée, puis les écrire dans la recette.
- **Un mode enregistreur** dans l'extension : l'utilisateur fait le parcours une fois, les
  sélecteurs sont observés plutôt que devinés.

**Voie retenue le 27/09/2026 : la reconnaissance par l'extension elle-même** (voir §14). Elle
réutilise le canal déjà prouvé au lieu d'ajouter un second outillage : l'utilisateur ouvre la page
dans son navigateur — il y est déjà connecté —, BYKO demande à l'extension de relever la
structure de cet onglet, et l'auteur de la recette en tire les sélecteurs réels. Rien à installer,
aucun contournement de la protection de Chrome, et la même mécanique servira plus tard à proposer
la réparation d'une recette cassée.

Ce qui reste certain : **la mécanique de la phase ③ ne dépend d'aucun sélecteur**. La chaîne de
capture est écrite, testée, et n'en connaît aucun.

## 14. Outil de maintenance — relevé de structure

| Élément | Fichier |
|---|---|
| Côté BYKO : demande, attente de la réponse, écriture du relevé | `src/main/browser-automation/recon.ts` |
| Côté extension : sélection de l'onglet et relevé | `browser-extension/service-worker.js` (`collectStructure`) |
| Déclenchement | variable d'environnement `BYKO_RECON_ORIGIN`, jamais posée par défaut |

Règles :

- **Aucune valeur de champ n'est jamais lue.** Le relevé ne collecte que des attributs d'une liste
  fermée et des libellés tronqués. Collecter `.value` serait le moyen le plus direct de faire
  sortir le secret qu'on vient de créer.
- **L'onglet est celui de l'utilisateur.** Rien n'est navigué, rien n'est rempli, rien n'est
  cliqué : la reconnaissance observe, elle n'agit pas.
- **Limite connue et documentée** : une page peut *afficher* un secret en texte visible — c'est le
  cas de l'écran qui vient de créer un client OAuth. Ce texte fait partie de la page et peut donc
  figurer dans le relevé. La parade est de relever sur un **client jetable**, supprimé ensuite.
- **Hors usage normal.** L'outil n'est activable que par une variable d'environnement explicite, et
  il est destiné à l'auteur des recettes, pas à l'utilisateur de BYKO.
