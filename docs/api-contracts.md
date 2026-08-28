# Contrat d'API interne — configuration & test de connexion

Ticket : **ARCHI-2**. Types faisant foi : [`lib/types/settings.ts`](../lib/types/settings.ts).

Ce document décrit le contrat, il ne le définit pas. **En cas d'écart entre ce fichier et
`lib/types/settings.ts`, c'est le fichier de types qui fait foi** — ce document est alors à
corriger.

## Périmètre

ARCHI-2 définit un contrat, il n'implémente aucun endpoint. `app/api/` n'existe pas encore
et ne doit pas être créé vide : les route handlers arrivent avec BACK-1, BACK-2, BACK-3 et
BACK-4. Le fichier de types est volontairement composé de types purs — aucun import, aucune
valeur exécutable, aucune fonction — pour être consommable à l'identique côté serveur
(`app/api/`) et côté composant front.

Les tables de providers (`lib/providers-links.ts`, `lib/providers-api.ts`) relèvent
d'ARCHI-2b et ne sont pas dans ce contrat. ARCHI-2 ne leur fournit que le type `ProviderId`.

## Jetons : ce que ce contrat garantit, et ce qu'il ne garantit pas

Règle actée au cadrage et reprise par ARCHI-3 : **aucun jeton n'est jamais renvoyé en clair
par une réponse d'API.**

**Ce qui est garanti.** Les jetons (`apiToken`) n'existent que dans les trois types
d'**entrée** — `JiraCredentials`, `FigmaCredentials`, `AiCredentials` — qui ne sont
référencés que par les corps de requête de `POST /api/settings/test-connection` et de
`POST /api/settings`. Aucun type de **sortie** ne déclare de champ jeton, même optionnel,
même imbriqué. En respectant le contrat, il n'existe aucun champ où poser un jeton.

**Ce qui n'est PAS garanti — à lire avant d'écrire BACK-1.** Le typage n'est pas une barrière
d'exécution. Le contrôle des propriétés excédentaires de TypeScript ne s'applique qu'à un
littéral frais assigné directement : dès que la valeur passe par une variable intermédiaire
ou un spread, un champ non déclaré voyage sans la moindre erreur de compilation. Le raccourci
le plus banal suffit, et ni `pnpm run lint`, ni `tsc`, ni `pnpm run build` ne le signalent :

```ts
const payload = { block, status: "success", account, ...credentials };
return payload;   // apiToken part dans la réponse — compile sans erreur
```

`NextResponse.json(body)` ne vérifie pas davantage le corps qu'il sérialise.

**Obligation qui en découle, à la charge de BACK-1, BACK-2, BACK-3 et BACK-4, et vérifiée à
chaque audit :** construire chaque réponse **champ par champ**, à partir des seules valeurs à
exposer. Jamais par spread, jamais par réutilisation d'un objet contenant des credentials,
corps de requête compris. **Ce contrat ne dispense d'aucun contrôle en sortie.**

Cette formulation remplace une version antérieure qui affirmait qu'une fuite « n'était pas un
oubli possible » — affirmation fausse, relevée en sévérité bloquante par l'audit du
29/08/2026. Dans la zone la plus sensible du projet, une garantie fausse est plus dangereuse
qu'une garantie absente.

**Frontière exacte.** ARCHI-3 interdit « la valeur du jeton », pas les métadonnées non
secrètes. L'URL d'instance Jira et le nom de compte sont donc renvoyés par
`GET /api/settings` : ce sont des informations que l'utilisateur a lui-même saisies ou que
le provider a confirmées, et que FRONT-5 et FRONT-12 doivent réafficher après un
rechargement de page. Les exposer n'affaiblit pas la règle ; les taire obligerait le front à
les figer en dur, ce que le critère d'acceptation de FRONT-5 interdit explicitement.

**Risque résiduel, non exprimable dans les types.** `message` est une chaîne libre affichée
telle quelle par le front (exigence de FRONT-3 : jamais de message générique). Si une
implémentation de BACK-1/2/3 construit un message qui recopie le jeton ou l'URL, le contrat
l'achemine jusqu'à l'écran sans rien enfreindre. **C'est une règle de rédaction à la charge
de BACK-1/2/3, à vérifier à l'audit** — le typage ne peut pas s'en prémunir.

## Vocabulaire

| Type | Valeurs | Rôle |
| --- | --- | --- |
| `ProviderId` | `anthropic`, `openai`, `deepseek`, `kimi`, `grok`, `gemini` | Les 6 providers IA de la liste fermée. Nom réservé par ARCHI-2b. |
| `ConnectionBlockId` | `jira`, `figma`, `ai` | Les 3 blocs de l'écran Connexions. |
| `ConnectionStatus` | `connected`, `not_connected`, `skipped` | Vocabulaire des statuts de connexion (ARCHI-3, BACK-4). `skipped` ne concerne que Figma. Alias de lecture : les types d'état écrivent leurs littéraux eux-mêmes, ils ne le référencent pas. |

Les types `TestConnectionRequestByBlock`, `TestConnectionResponseByBlock` et
`SettingsUpdateByBlock` sont également exportés : ce sont les tables qui portent les
helpers `…For<…>` décrits plus bas. Un consommateur n'a normalement pas à les manipuler
directement.

### Divergences assumées avec l'énoncé d'ARCHI-2 (arbitrées le 29/08/2026)

Trois écarts au texte du ticket, tous délibérés. **BACK-1, BACK-2, BACK-3 et BACK-4 doivent
implémenter le contrat, pas la ligne 49 du ticket.**

1. **Le discriminant s'appelle `block`, pas `provider`.** Le ticket écrit
   `{ provider: "jira" | "figma" | "ai", ... }`. ARCHI-2b réserve le mot « provider » aux 6
   providers IA ; garder `provider` pour les deux notions produirait un corps de requête IA
   portant `provider: "ai"` **et** un sous-champ `provider: "openai"` — illisible et source
   d'erreur d'implémentation. Le nom `provider` reste utilisé uniquement pour désigner lequel
   des 6 modèles IA, à l'intérieur de `AiCredentials`.
2. **`message` est requis en erreur**, là où le ticket écrit `message?: string`. Motif :
   FRONT-3 impose d'afficher le message précis du backend et jamais un texte générique ; un
   message optionnel rendrait ce critère intenable. Le resserrement ne concerne que les
   variantes d'erreur — `success` et `pending` ne portent aucun message.
3. **Un champ `code` optionnel a été ajouté** aux erreurs de test de connexion, absent de
   l'énoncé. Ses 9 valeurs sont toutes sourcées une à une dans BACK-1/2/3, mais le champ
   lui-même est une extension. Motif : BACK-2 exige qu'un 429 ne soit pas confondu avec un
   jeton invalide, ce qui suppose un signal exploitable sans analyser du texte français.
   Il reste optionnel et n'est jamais affiché — `message` demeure la seule source d'affichage.

## `POST /api/settings/test-connection`

Teste une connexion à la volée. **Ne persiste rien** (la persistance est `POST /api/settings`,
ticket BACK-4). Déclenché automatiquement au blur du champ jeton, sans bouton « Tester »
(règle produit).

**Requête** — `TestConnectionRequest`, union discriminée par `block` :

| `block` | `credentials` |
| --- | --- |
| `"jira"` | `{ instanceUrl, apiToken }` |
| `"figma"` | `{ apiToken }` |
| `"ai"` | `{ provider: ProviderId, apiToken }` |

Pour typer un bloc précis : `TestConnectionRequestFor<"jira">`.

La discrimination par `block` empêche d'écrire directement un littéral mélangeant le bloc d'un
autre, et permet le narrowing à la lecture. **Ce n'est pas une validation d'entrée** : la même
limite qu'au §Jetons s'applique ici — passé par une variable intermédiaire, un corps mal
apparié compile. Et un corps arrivant du réseau n'est de toute façon pas vérifié par le
typage : **BACK-1/2/3/4 doivent valider les corps de requête à la frontière**, ce contrat en
décrit la forme attendue, il ne la contrôle pas.

**Réponse** — `TestConnectionResponse`, discriminée d'abord par `block`, puis par `status`.
Toutes les variantes portent `block`, écho du champ de la requête : le test automatique au
blur permet plusieurs tests en vol simultanément, et le front doit rattacher chaque réponse à
son bloc sans se fier à l'ordre d'arrivée.

| `status` | Charge utile |
| --- | --- |
| `"success"` | Jira : `account.accountName` (requis). Figma : `account?` (optionnel, BACK-2 ne le promet que « si disponible »). IA : rien, aucun ticket ne cite de métadonnée. |
| `"error"` | `message` **requis**, `code` optionnel. |
| `"pending"` | Rien. Voir la question ouverte plus bas. |

`message` est requis en erreur parce que FRONT-3 impose d'afficher le message précis du
backend et jamais un texte générique : un message optionnel rendrait ce critère intenable.

`code` est un signal machine, optionnel, destiné au front qui doit réagir différemment sans
analyser du texte français (BACK-2 : un 429 ne doit pas être confondu avec un jeton
invalide). Les codes couvrent **uniquement** les cas explicitement cités par les tickets :

| Bloc | Codes | Source |
| --- | --- | --- |
| Jira | `invalid_url`, `invalid_token`, `instance_unreachable`, `timeout` | BACK-1 |
| Figma | `invalid_token`, `rate_limited` | BACK-2 |
| IA | `invalid_token`, `quota_exceeded`, `provider_unavailable` | BACK-3 |

Il est volontairement optionnel : la liste ne couvre pas tout, et un `code` obligatoire
forcerait une implémentation à ranger un échec imprévu dans une catégorie fausse.
**`message` reste la seule source d'affichage.**

Asymétrie connue et assumée : `timeout` n'existe que pour Jira, parce que BACK-1 est le seul
ticket à citer ce cas. Un incident réseau côté Figma ou IA arrivera donc sans `code` — un
front qui voudrait proposer « réessayer » ne pourra le faire que pour Jira. À revoir si
BACK-2 ou BACK-3 formalisent leur propre cas de timeout.

## `GET /api/settings`

Renvoie l'état persisté de la configuration. Jamais de jeton.

**Réponse** — `GetSettingsResponse` :

- `{ status: "success", settings: SettingsState }`
- `{ status: "error", message }` — `message` requis, pas de `code` (aucun ticket n'en cite
  pour ce cas).

La variante d'erreur n'est pas décorative. FRONT-1 conditionne l'affichage du wizard à cet
appel, et ARCHI-3 rend l'échec de lecture réel (fichier chiffré illisible, clé de chiffrement
absente). Sans elle, une panne serait indistinguable d'un état vide et l'onboarding serait
resservi à un utilisateur déjà configuré. **Un appelant ne doit jamais rabattre une erreur de
lecture sur « aucune configuration ».**

`SettingsState` porte les trois blocs :

| Bloc | Statuts possibles | Charge utile quand `connected` |
| --- | --- | --- |
| `jira` | `connected`, `not_connected` | `instanceUrl`, `account.accountName` |
| `figma` | `connected`, `not_connected`, `skipped` | `account?` (optionnel) |
| `ai` | `connected`, `not_connected` | `provider: ProviderId` |

`skipped` est structurellement interdit sur Jira et sur l'IA : la règle produit les rend
obligatoires pour terminer le wizard. Chaque bloc est une union discriminée sur `status`, ce
qui rend les métadonnées non représentables quand la connexion n'est pas établie — il n'y a
donc aucun champ nullable à défendre côté front.

## `POST /api/settings`

Sauvegarde **un seul bloc par requête** (BACK-4 : la sauvegarde est indépendante par bloc).

**Requête** — `SaveSettingsRequest`, discriminée par `block` :

| `block` | Corps |
| --- | --- |
| `"jira"` | `{ credentials: JiraCredentials }` |
| `"figma"` | `{ credentials: FigmaCredentials }` **ou** `{ skipped: true }` |
| `"ai"` | `{ credentials: AiCredentials }` |

Le littéral `true` est volontaire : un `skipped: false` n'aurait pas de sens défini. C'est le
seul canal permettant à BACK-4 de distinguer `skipped` de `not_connected` pour Figma.

**Réponse** — `SaveSettingsResponse` : `{ block, status: "success" }` ou
`{ block, status: "error", message }`. Aucun ticket ne spécifie cette réponse ; la forme
reprend le vocabulaire déjà en place plutôt que d'en introduire un nouveau.

`block` est présent pour la même raison que sur le test de connexion : BACK-4 sauvegarde
chaque connexion validée immédiatement, donc dans le flux du test au blur — deux sauvegardes
peuvent être en vol et l'erreur de Figma s'afficher sur le bloc Jira.

**Limite à connaître :** `block` y est typé `ConnectionBlockId`, et non lié par générique au
bloc de la requête comme l'est `TestConnectionResponseFor<…>`. Le typage n'oblige donc pas la
réponse à faire écho au bon bloc — c'est une discipline d'implémentation à respecter dans
BACK-4. Ce choix évite d'exporter un helper générique qu'aucun ticket ne demande ; il est
réversible en quelques lignes si le besoin se confirme.

## Questions ouvertes — à trancher avant BACK-1/BACK-4

Ces points sont **connus et non résolus**. Ils ne sont pas des oublis : chacun demande un
arbitrage produit ou un ticket dédié, et aucun n'a été comblé par une valeur inventée.

1. **`pending` n'a aucun producteur identifié.** ARCHI-2 impose littéralement
   `"success" | "error" | "pending"`, et le contrat le respecte. Mais un
   `POST /api/settings/test-connection` synchrone répond `success` ou `error` ; BACK-1/2/3 ne
   décrivent jamais le renvoi d'un `pending`, et le contrat n'offre ni identifiant de test ni
   endpoint de suivi permettant de le résoudre. En pratique l'état « en cours » de FRONT-3 est
   un état client, le temps que la requête soit en vol. **À trancher :** retirer `pending` de
   la réponse, ou assumer un test asynchrone et le compléter. En attendant, le front doit
   traiter cette branche sans supposer qu'elle est inatteignable.

2. **Aucun marqueur « onboarding terminé ».** FRONT-1 ne doit s'afficher qu'au tout premier
   lancement « vérifié via l'état de configuration, pas un simple flag local trivial à
   contourner », et FRONT-5 doit « marquer la configuration initiale comme terminée ». Aucune
   des trois opérations d'ARCHI-2 ne l'exprime. Le déduire de trois statuts serait faux : un
   utilisateur ayant terminé le wizard puis dont le jeton IA expire retomberait sur l'écran
   d'intro. **Manque à couvrir par un ticket dédié ou un avenant à BACK-4**, en lien avec
   ARCHI-3 pour le lieu de persistance.

3. **La cause d'un échec n'est pas persistée.** Pendant la session, FRONT-4 reconstitue son
   bandeau depuis les réponses de test. Après un rechargement, il ne reste que
   `not_connected`, qui confond trois situations distinctes : jamais saisi / saisi et invalide
   / valide autrefois puis expiré. Le front peut dire *quel* bloc bloque, jamais *pourquoi*,
   et ne peut pas relancer le test lui-même puisqu'il n'a pas le jeton. **À trancher :** soit
   `GET /api/settings` expose la dernière erreur connue par bloc — avec la garantie de
   rédaction du §Risque résiduel, puisqu'on persisterait alors un message —, soit le produit
   accepte un bandeau sans cause après rechargement et le libellé de référence de FRONT-4 est
   révisé.

4. **Convention de code HTTP non arbitrée.** Le contrat définit l'enveloppe applicative
   (`status`) mais pas le code HTTP qui l'accompagne. Sans convention commune, BACK-1, BACK-2
   et BACK-3 divergeront et chaque appel front devra deviner s'il doit tester `res.ok` avant
   de lire le corps. *Proposition à confirmer, non appliquée à ce stade :* un test de connexion
   qui aboutit renvoie `200` quel que soit son verdict — « ce jeton est invalide » est une
   réponse valide à la question posée, pas une panne — et les codes `4xx`/`5xx` sont réservés
   aux requêtes malformées et aux défaillances serveur. L'enveloppe `status` reste dans tous
   les cas la source de vérité applicative.

5. **Pas de suppression ni de déconnexion.** Rien n'exprime « supprimer mon jeton Jira » ou
   « annuler le passage de Figma ». Aucun critère d'acceptation de la phase 1 ne l'exige ; à
   revoir à FRONT-12.

6. **Pas de garde de type à l'exécution.** Le fichier est volontairement composé de types
   purs, donc tout consommateur écrira un `as` à la frontière de parsing. L'audit signale la
   conséquence concrète : un `200 OK` au corps vide ou tronqué, casté en `GetSettingsResponse`,
   sera lu comme `status !== "error"`, donc comme « aucune configuration » — exactement la
   confusion que la variante d'erreur avait été ajoutée pour empêcher. **La protection existe
   dans les types, elle est contournable à la frontière de parsing.** Si le besoin se confirme,
   un fichier séparé `lib/types/settings.guards.ts` est préférable à une validation improvisée
   dans chaque composant — sans dépendance externe, la contrainte d'ARCHI-1 s'appliquant
   toujours.

7. **« Nom de l'instance Jira » (FRONT-5) : rien ne porte exactement ce nom.** Le contrat
   expose `instanceUrl` (l'URL saisie par l'utilisateur) et `account.accountName` (le nom du
   compte). BACK-1 parle d'un ambigu « nom du compte/instance ». Le Récap afficherait donc une
   URL, ou un nom de compte, là où la maquette annonce un nom d'instance. **À trancher avec la
   maquette** — aucun champ `instanceName` n'a été ajouté, faute de source, et surtout pour ne
   pas créer un champ que le backend n'aurait pas de moyen honnête de remplir.

## Revue croisée (critère d'acceptation d'ARCHI-2)

Le ticket exige que le contrat soit « relu et validé par le backend-engineer et le
frontend-integrator avant implémentation ». Trace de cette revue, pour qu'elle ne repose pas
sur la mémoire d'une session :

- **Définition** — `backend-engineer`, 29/08/2026.
- **Relecture de consommabilité** — `frontend-integrator`, 29/08/2026, sur les six écrans
  FRONT-1 à FRONT-6. Verdict initial : non consommable en l'état. Trois manques bloquants
  retenus et corrigés : absence des métadonnées durables dans `GET /api/settings` (l'écran
  Récap aurait dû figer des valeurs en dur, ce que son critère d'acceptation interdit),
  absence de variante d'erreur sur `GET /api/settings` (une panne de lecture aurait été
  rabattue sur « aucune configuration »), et union de réponse non réellement discriminée.
  Trois autres manques signalés ont été refusés en l'état et versés aux questions ouvertes
  ci-dessus (marqueur d'onboarding, cause d'échec persistée, `pending`) plutôt que comblés par
  des champs inventés.
- **Audit** — `qa-log-auditor`, 29/08/2026 :
  [`docs/qa-reports/2026-08-29-archi-2.md`](qa-reports/2026-08-29-archi-2.md). Un constat
  bloquant (garantie de non-exposition des jetons surestimée) corrigé ici même et dans
  l'en-tête du fichier de types. Constats « à surveiller » traités : `block` ajouté à
  `SaveSettingsResponse`, `RequiredConnectionStatus` supprimé. Les autres sont consignés dans
  les questions ouvertes ci-dessus et restent ouverts sciemment.
- **Arbitrage et validation finale** — `orchestrator`, 29/08/2026.
