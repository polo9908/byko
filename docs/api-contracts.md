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

**Ce risque change d'échelle depuis l'arbitrage du 31/08/2026 (décision n°3).** La dernière
erreur connue par bloc est désormais persistée et relue par `GET /api/settings`
(`PersistedConnectionError.message`). Un message qui recopie un jeton ou une URL n'est donc
plus fugace : il est écrit sur disque, puis renvoyé à chaque chargement de page, y compris
longtemps après que le jeton a été corrigé. Deux charges nommément distinctes :

- **BACK-1, BACK-2, BACK-3 — rédaction.** Un message d'erreur ne doit contenir ni jeton, ni
  fragment de jeton, ni corps de réponse brut du provider (qui peut renvoyer la requête,
  en-têtes d'autorisation compris). Vaut pour la réponse de test comme pour le message
  transmis à la persistance : c'est la même chaîne.
- **BACK-4 — persistance.** Ne persiste que le `message` fourni par le test : ni concaténé
  avec le corps de requête, **ni recopié depuis un objet qui porte aussi des credentials**.
  Ce second chemin est le plus banal, et il compile sans la moindre erreur :

  ```ts
  const raw = { message: "échec", apiToken };
  const s: JiraSettingsState = { status: "not_connected", lastError: raw };
  // le jeton part sur le disque — aucune erreur de compilation
  ```

  C'est exactement le raccourci déjà interdit plus haut (« jamais par réutilisation d'un
  objet contenant des credentials »), rappelé ici parce que la persistance en rend l'effet
  durable. `lastError` vit dans la configuration, donc sous le régime de chiffrement
  d'ARCHI-3 comme le reste ; et son critère d'acceptation
  (ligne 183 : « `GET /api/settings` ne contient jamais de jeton en clair, y compris dans les
  logs de requête ») couvre désormais aussi ce champ, puisqu'il est relu tel quel à chaque
  appel.

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

### Divergences assumées avec l'énoncé d'ARCHI-2

Quatre écarts au texte du ticket, tous délibérés — les trois premiers arbitrés le
29/08/2026, le quatrième le 31/08/2026. **BACK-1, BACK-2, BACK-3 et BACK-4 doivent
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
   variantes d'erreur — `success` ne porte aucun message.
3. **Un champ `code` optionnel a été ajouté** aux erreurs de test de connexion, absent de
   l'énoncé. Ses 9 valeurs sont toutes sourcées une à une dans BACK-1/2/3, mais le champ
   lui-même est une extension. Motif : BACK-2 exige qu'un 429 ne soit pas confondu avec un
   jeton invalide, ce qui suppose un signal exploitable sans analyser du texte français.
   Il reste optionnel et n'est jamais affiché — `message` demeure la seule source d'affichage.
4. **Le statut `pending` n'existe pas** (arbitré le 31/08/2026), là où le ticket écrit
   littéralement `"success" | "error" | "pending"`. Motif : `POST /api/settings/test-connection`
   est synchrone, la réponse serveur ne porte que le verdict — `success` ou `error`. Aucun
   des tickets BACK-1/2/3 ne décrit le renvoi d'un `pending`, et le contrat n'offre ni
   identifiant de test ni endpoint de suivi qui permettrait de le résoudre. L'état « en
   cours » de FRONT-3 (spinner, ligne 245) reste un état local au front pendant que la
   requête HTTP est en vol : il n'a pas de représentation dans le contrat, et le front n'a
   pas de branche `pending` à traiter à la lecture d'une réponse.

## Convention de codes HTTP (actée le 31/08/2026)

Vaut pour les trois endpoints de ce contrat.

**Portée : l'extension aux trois endpoints est une généralisation, pas du texte arbitré.**
L'arbitrage du 31/08/2026 portait sur `POST /api/settings/test-connection` (« un test de
connexion qui aboutit renvoie toujours `200` ») ; la phrase sur les `4xx`/`5xx` était posée
sans périmètre explicite. L'étendre aux trois endpoints évite précisément la divergence
d'implémentation que la décision cherche à empêcher — mais c'est une extension de cohérence,
au même titre que le champ `code` (divergence assumée n°3), et elle est **réversible** si le
décideur la restreint au seul test de connexion.

- **Un appel qui aboutit renvoie `200`, quel que soit son verdict applicatif.** « Ce jeton est
  invalide » est une réponse valide à la question posée, pas une panne : un test de connexion
  qui a bien joint le provider et obtenu un refus répond `200` avec `status: "error"`.
- **`4xx` / `5xx` sont réservés aux requêtes malformées et aux défaillances serveur** — corps
  de requête invalide, bloc inconnu, exception non rattrapée.
- **L'enveloppe `status` est la source de vérité applicative** dans tous les cas.

**Cas `GET /api/settings` — un échec de lecture RATTRAPÉ est un `200`.** Fichier chiffré
illisible, clé de chiffrement absente : dès lors que le serveur détecte et rattrape la
panne, il répond `200` avec la variante d'erreur de `GetSettingsResponse`
(`{ status: "error", message }`), et le front lit ce `message`. Motif, identique à celui
déjà acté pour le test de connexion : l'appel a abouti, le serveur **sait** répondre et a un
message précis à transmettre — c'est un verdict applicatif, pas une panne de transport. Les
`5xx` restent pour ce que le serveur ne rattrape pas (exception non gérée), cas où le corps
n'est effectivement pas garanti conforme au contrat. Sans cette précision, BACK-4 pouvait
légitimement choisir `500` et le front, appliquant « `res.ok === false` ⇒ pas de verdict »,
jetait un `message` pourtant conforme et requis.

**Portée de ce cas : même nature que l'extension aux trois endpoints — une décision de
cohérence, pas du texte arbitré.** Elle a été prise par l'orchestrateur le 31/08/2026 pour
rendre le contrat décidable ; l'arbitrage produit ne portait que sur le test de connexion et
ne dit rien de l'échec de lecture. Elle est **réversible** si le décideur en juge autrement.

Conséquence pour le front : lire le corps et se fier à `status`. `res.ok` ne distingue pas
un succès d'un échec logique ; il ne sert qu'à repérer les deux cas `4xx`/`5xx` ci-dessus
(requête malformée, défaillance non rattrapée), où le corps n'est pas garanti conforme au
contrat.

**Quand le corps n'est pas conforme** (`res.ok === false`, ou un `200` au corps vide), il n'y
a **pas de verdict** : le front rend une panne de transport, distincte du verdict `error` de
FRONT-3 (ligne 245), et **n'en tire aucune affirmation sur le jeton** — rabattre un `500` sur
« jeton invalide » est exactement l'invention que la règle interdit, d'autant que le front n'a
alors aucun message de l'API alors que FRONT-3 (ligne 251) exige que le message affiché en
vienne. Le libellé exact de cette panne de transport est du copy, **non tranché ici**.

Conséquence pour BACK-1/2/3/4 : ne pas traduire un `status: "error"` en `4xx`. Sans cette
convention, chaque implémentation choisirait la sienne et chaque appel front devrait deviner
s'il doit tester `res.ok` avant de lire le corps.

## `POST /api/settings/test-connection`

Teste une connexion à la volée. **Ne persiste rien** (la persistance est `POST /api/settings`,
ticket BACK-4). Déclenché automatiquement au blur du champ jeton, sans bouton « Tester »
(règle produit).

**Requête** — `TestConnectionRequest`, union discriminée par `block` :

| `block` | `credentials` |
| --- | --- |
| `"jira"` | `{ instanceUrl, email, apiToken }` |
| `"figma"` | `{ apiToken }` |
| `"ai"` | `{ provider: ProviderId, apiToken }` |

**`email` ajouté au bloc Jira le 04/09/2026, pendant BACK-1.** Un jeton API Jira **Cloud**
classique s'authentifie en Basic auth (`base64(email:jeton)`), pas en
`Authorization: Bearer <jeton>` seul — réservé aux jetons OAuth 2.0 (3LO) ou aux Personal
Access Tokens Data Center. Sondes réelles sans jeton sur `ecosystem.atlassian.net`
(`lib/jira-connection.ts`) : `Bearer` invalide → 403, `Basic` invalide → 401 (comportement
standard). Impact : FRONT-2 doit prévoir un champ e-mail dans le bloc Jira, en plus de
l'URL d'instance et du jeton.

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

Il n'y a que ces deux valeurs de `status` : le test est synchrone, `pending` a été retiré du
contrat le 31/08/2026 (divergence assumée n°4).

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

Renvoie l'état persisté de la configuration. Aucun champ jeton n'y est déclaré — ce qui
n'exonère pas de la règle de rédaction du §Jetons, `lastError.message` étant une chaîne libre.

**Réponse** — `GetSettingsResponse` :

- `{ status: "success", settings: SettingsState }`
- `{ status: "error", message }` — `message` requis, pas de `code` (aucun ticket n'en cite
  pour ce cas). Code HTTP de cette variante quand le serveur a rattrapé l'échec de lecture :
  `200`, voir §« Convention de codes HTTP ».

La variante d'erreur n'est pas décorative. FRONT-1 conditionne l'affichage du wizard à cet
appel, et ARCHI-3 rend l'échec de lecture réel (fichier chiffré illisible, clé de chiffrement
absente). Sans elle, une panne serait indistinguable d'un état vide et l'onboarding serait
resservi à un utilisateur déjà configuré. **Un appelant ne doit jamais rabattre une erreur de
lecture sur « aucune configuration ».**

`SettingsState` porte les trois blocs :

| Bloc | Statuts possibles | Charge utile quand `connected` | Charge utile quand `not_connected` |
| --- | --- | --- | --- |
| `jira` | `connected`, `not_connected` | `instanceUrl`, `email`, `account.accountName` | `lastError?` |
| `figma` | `connected`, `not_connected`, `skipped` | `account?` (optionnel) | `lastError?` |
| `ai` | `connected`, `not_connected` | `provider: ProviderId` | `lastError?` |

`skipped` est structurellement interdit sur Jira et sur l'IA : la règle produit les rend
obligatoires pour terminer le wizard. Chaque bloc est une union discriminée sur `status`, ce
qui rend les métadonnées non représentables quand la connexion n'est pas établie — il n'y a
donc aucun champ nullable à défendre côté front. Symétriquement, `lastError` n'est atteignable
qu'après avoir testé `status === "not_connected"` (§ci-dessous).

### Cause du dernier échec, persistée (acté le 31/08/2026)

`lastError` porte la dernière erreur connue du bloc : `message` requis, `code` optionnel,
**exactement le vocabulaire de `TestConnectionError`** dont il est la trace persistée. Aucun
autre champ : ni horodatage, ni compteur de tentatives, qu'aucun ticket ne demande.

Son type est **générique sur le code d'erreur du bloc et n'a pas de paramètre par défaut** :
on écrit `PersistedConnectionError<JiraTestConnectionErrorCode>` (respectivement
`<FigmaTestConnectionErrorCode>`, `<AiTestConnectionErrorCode>`). Le citer nu —
`const e: PersistedConnectionError = …` — ne compile pas (`TS2314`).

Besoin source, et ce qu'il dit exactement : FRONT-4 (ligne 266) exige un bandeau qui
« explique précisément quel bloc bloque ». Le *pourquoi* ne vient pas de cette phrase mais du
libellé de référence donné en exemple sur la même ligne (« … le jeton du Modèle IA est
invalide »), qui nomme la cause ; c'est une **lecture de ce libellé**, pas la lettre de
l'exigence, et c'est cette lecture qui motive `lastError`.

Pendant la session, le front reconstitue son bandeau depuis les réponses de test ; après
un rechargement, `not_connected` seul confond « jamais saisi », « saisi et invalide » et
« valide autrefois puis expiré », et le front ne peut pas relancer le test lui-même puisqu'il
n'a pas le jeton.

**Placement :** `lastError` n'existe **que** sur la variante `not_connected`, sur les trois
blocs. C'est le seul état où un bloc bloque réellement (FRONT-4 ligne 265 : « Terminer »
désactivé tant que Jira et l'IA ne sont pas `connected`), donc le seul où la cause a un
lecteur. Le déclarer sur `connected` créerait un champ que rien n'affiche et qui pourrait
contredire le statut. Il est absent de `skipped` : « Passer cette étape » est une action
explicite de l'utilisateur (BACK-4 ligne 179), pas un échec.

**Optionnel, et l'absence est une information :** pas de `lastError` sur un bloc
`not_connected` signifie « aucun échec connu » — typiquement jamais saisi. Un front ne doit
pas fabriquer un libellé de cause dans ce cas.

**Charge d'implémentation :** BACK-4 persiste ce champ à partir du `message` renvoyé par le
test (BACK-1/2/3). Le champ n'étant pas déclaré sur `connected`, un bloc qui repasse
`connected` ne peut pas traîner une cause périmée : la question ne se pose pas dans la
réponse, elle reste une discipline de nettoyage côté stockage. Contrainte de rédaction et de
persistance : voir le §Risque résiduel, qui nomme les charges de BACK-1/2/3 et de BACK-4.

### « Nom de l'instance Jira » de FRONT-5 : à dériver d'`instanceUrl`

Arbitrage produit du 31/08/2026, sur la maquette Claude Design de référence, artboard
« 3 — Récap » (maquette hors dépôt) : sous « Jira », le Récap affiche une valeur **dérivée
de l'`instanceUrl` saisie**, et non `account.accountName`. Ce qui est tranché, c'est la
**source** du champ ; la **forme** de la dérivation ne l'est pas — voir les deux niveaux de
certitude ci-dessous. L'exemple observé dans la maquette est `axara.atlassian.net`.

Conséquence : **aucun champ n'est ajouté au contrat**, `instanceUrl` suffit.
`account.accountName` reste disponible et reste ce que BACK-1 renvoie comme « nom du
compte/instance » ; il n'est simplement pas ce qu'affiche le Récap sous « Jira ».

Deux niveaux de certitude, à ne pas confondre :

- **Tranché** — la source du champ affiché : c'est `instanceUrl`, pas `account.accountName`.
  C'est ce que l'arbitrage a établi, et c'est ce qui engage le contrat.
- **Lecture retenue, à confirmer** — la forme exacte de la dérivation : n'afficher que le nom
  d'hôte, sans le schéma `https://`. L'arbitrage la formule comme probable, pas comme acquise,
  et la maquette est hors dépôt. **FRONT-5 confirme ce point sur la maquette avant de
  l'implémenter** ; il ne change pas la source du champ, seulement son formatage.

`axara.atlassian.net` est un exemple relevé dans la maquette, pas une valeur du produit :
rien ne doit être figé en dur, le critère d'acceptation de FRONT-5 (ligne 292, « pas de
valeurs figées/statiques ») l'interdit.

**Non tranché — la forme d'`instanceUrl`.** Le contrat déclare `instanceUrl: string` sans
aucune garantie de forme, alors qu'il demande désormais à FRONT-5 d'en dériver un nom d'hôte.
Comportement vérifié à l'exécution par la relecture de consommabilité du 31/08/2026 :

| `instanceUrl` persistée | Nom d'hôte dérivé |
| --- | --- |
| `"https://axara.atlassian.net"` | `axara.atlassian.net` |
| `"https://axara.atlassian.net/"` | `axara.atlassian.net` |
| `"https://axara.atlassian.net/jira"` | `axara.atlassian.net` |
| `"axara.atlassian.net"` | lève `ERR_INVALID_URL` |

Si BACK-4 persiste la chaîne telle que saisie et que l'utilisateur a tapé le domaine sans
schéma, la dérivation lève et le Récap n'a plus rien à afficher. Deux options, aucune retenue
à ce jour — ni l'arbitrage du 31/08/2026 ni la relecture ne l'ont tranchée :

1. **BACK-4 persiste une URL absolue normalisée** (schéma inclus), et ce contrat le garantit
   alors explicitement.
2. **La chaîne persistée est celle saisie**, et FRONT-5 écrit une dérivation tolérante à
   l'absence de schéma.

**Aucun champ n'est ajouté au contrat pour ce point.** Porteurs : **BACK-4** (forme
persistée) et **FRONT-5** (dérivation). À trancher avant l'implémentation de l'un des deux.

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

## Décisions actées le 31/08/2026 (ex-« Questions ouvertes »)

Les 7 questions laissées ouvertes par ARCHI-2 le 29/08/2026 ont été tranchées le 31/08/2026
par le décideur produit. **Aucune n'est plus ouverte.** Cette section remplace la section
« Questions ouvertes — à trancher avant BACK-1/BACK-4 » et dit, pour chacune, ce qui est
décidé et ce qui reste à faire, par qui.

Trois d'entre elles modifient le contrat (n°1, n°3, n°4), deux sont reportées à un ticket
identifié (n°5, n°6), une devient un avenant à BACK-4 (n°2), une est résolue sans changement
de contrat (n°7).

1. **`pending` est retiré du contrat.**
   *Décidé :* le test de connexion est synchrone ; la réponse serveur ne vaut que `success`
   ou `error`. `TestConnectionPending` a été supprimé de `lib/types/settings.ts` et les trois
   unions de réponse ne comptent plus que deux variantes. Écart assumé avec l'énoncé du
   ticket, consigné en divergence n°4.
   *Reste à faire :* rien côté contrat. **FRONT-3** garde son spinner comme état local
   pendant que la requête HTTP est en vol — il n'y a pas de branche `pending` à traiter à la
   lecture d'une réponse. **BACK-1/2/3** ne doivent jamais renvoyer `status: "pending"`.

2. **Marqueur « onboarding terminé » : avenant à BACK-4, pas de ticket séparé.**
   *Décidé :* la persistance de configuration que créera BACK-4 portera un booléen explicite
   (ex. `onboardingCompleted`). Le besoin est sourcé : FRONT-1 ne s'affiche qu'au premier
   lancement, « vérifié via l'état de configuration, pas un simple flag local trivial à
   contourner » (ligne 204) ; FRONT-5 doit « marquer la configuration initiale comme
   terminée » (ligne 293). Le déduire des trois statuts serait faux : un utilisateur ayant
   terminé le wizard puis dont le jeton IA expire retomberait sur l'écran d'intro.
   *Non fait volontairement :* `lib/types/settings.ts` n'est **pas** modifié sur ce point
   (décision explicite du 31/08/2026) — ni `SettingsState`, ni `GetSettingsResponse`, ni la
   requête de sauvegarde ne déclarent ce champ.
   *Limite connue, à lever au moment de BACK-4 :* tant que le contrat de **lecture** ne
   l'expose pas, **FRONT-1 n'a aucun moyen de lire ce marqueur** — il ne dispose que des
   trois statuts, dont la décision ci-dessus dit précisément qu'ils ne suffisent pas. Le
   marqueur n'est donc utile qu'une fois exposé par `GET /api/settings` et écrit par
   `POST /api/settings` (ou par l'opération que BACK-4 retiendra). Ce n'est pas comblé ici :
   c'est à trancher dans l'avenant BACK-4, en lien avec ARCHI-3 pour le lieu de persistance.
   *Limite confirmée et élargie par la relecture de consommabilité du 31/08/2026*, sur trois
   points vérifiés par sondes compilées :
   - **La lecture ne suffit pas : il faut aussi une écriture.** FRONT-5 (ligne 293) exige que
     le bouton final « marque la configuration initiale comme terminée ». Or
     `SaveSettingsRequest` n'a aujourd'hui aucune variante permettant de l'écrire — la sonde
     `{ block: "onboarding", completed: true }` est refusée à la compilation. L'avenant BACK-4
     doit donc couvrir **lecture et écriture**, pas seulement l'exposition en lecture.
   - **Le blocage ne porte pas que sur FRONT-1.** Il porte aussi sur le critère d'acceptation
     de FRONT-5 (ligne 293, ci-dessus) et sur l'entrée de FRONT-6 (ligne 307 : le bouton
     compte est « hors wizard », ce qui suppose de savoir qu'on est sorti du wizard).
   - **La porte que cette décision déclare fausse compile.** La déduction par les statuts
     (`jira === "connected" && ai === "connected"`) passe la compilation : rien n'empêche
     techniquement un développeur de l'écrire, alors que la décision ci-dessus établit qu'elle
     est fausse (jeton IA expiré → retour sur l'écran d'intro). C'est un piège qui se referme
     en silence, à nommer explicitement dans l'avenant.
   *Reste à faire :* **BACK-4** (avenant, lecture **et** écriture), puis mise à jour de ce
   contrat et du fichier de types au même moment. **FRONT-1** (ligne 204), **FRONT-5**
   (ligne 293) et **FRONT-6** (ligne 307) dépendent de cette levée.

3. **La cause du dernier échec est persistée et exposée par `GET /api/settings`.**
   *Décidé :* chaque bloc expose `lastError`, typé avec le code d'erreur de son bloc — p. ex.
   `PersistedConnectionError<AiTestConnectionErrorCode>` pour l'IA — `message` requis, `code`
   optionnel, pour que FRONT-4 continue d'afficher la cause après un rechargement de page.
   Détail de forme, placement sur la seule variante `not_connected` et justification (qui est
   une lecture du libellé de référence de FRONT-4, non la lettre de son exigence) :
   §« Cause du dernier échec, persistée ».
   *Ajouté :* `lib/types/settings.ts` (`PersistedConnectionError` + `lastError` sur les trois
   états de bloc) et le §`GET /api/settings` de ce document. **Aucune implémentation serveur
   n'est écrite** : ARCHI-2 reste un contrat.
   *Reste à faire :* **BACK-1/2/3** — rédiger des messages qui ne recopient jamais un jeton,
   contrainte désormais durable (§Risque résiduel). **BACK-4** — persister et relire ce
   champ. **FRONT-4** — n'inventer aucune cause quand `lastError` est absent.

4. **Convention de codes HTTP : actée.**
   *Décidé :* un appel qui aboutit — succès comme échec logique (jeton invalide, quota,
   429…) — répond `200`, le verdict vivant dans `status`. `4xx`/`5xx` sont réservés aux
   requêtes malformées et aux pannes serveur. Ce qui figurait ici comme « proposition à
   confirmer, non appliquée » est désormais la règle : voir §« Convention de codes HTTP ».
   *Reste à faire :* **BACK-1/2/3/4** appliquent la convention ; le front lit le corps et se
   fie à `status`.

5. **Suppression / déconnexion d'un jeton : reporté à FRONT-12.**
   *Décidé :* aucun changement de contrat. Rien n'exprime « supprimer mon jeton Jira » ou
   « annuler le passage de Figma », et **aucun critère d'acceptation de la phase 1 ne
   l'exige** — c'est la raison du report, pas un oubli.
   *Reste à faire :* **FRONT-12** (phase 3), qui dira s'il faut une opération de suppression
   et donc un avenant à ce contrat.

6. **Garde de type à l'exécution : reporté — mais le report ne couvre que la frontière
   serveur.**
   *Décidé :* `lib/types/settings.guards.ts` **n'est pas créé maintenant**. Il le sera au
   moment où ces tickets en auront réellement besoin pour valider les corps de requête
   entrants. Cette décision de ne rien créer reste valable. Le constat de l'audit reste
   valable et n'est pas contesté : le fichier de types est pur, tout consommateur écrira un
   `as` à la frontière de parsing. **La protection existe dans les types, elle est
   contournable à la frontière de parsing.**
   *Deux frontières, à ne pas confondre :*
   - **Frontière serveur — couverte par ce report.** Les corps de requête entrants sont
     validés par **BACK-1/2/3/4** au moment de leur implémentation. Si un fichier de gardes
     est écrit, un module séparé est préférable à une validation improvisée dans chaque
     composant, et sans dépendance externe (contrainte d'ARCHI-1 toujours en vigueur).
   - **Frontière client — NON couverte par ce report.** Un `200` au corps vide, casté en
     `GetSettingsResponse` côté front, se lit comme `status !== "error"`, donc comme « aucune
     configuration », et resservirait le wizard à un utilisateur déjà configuré (FRONT-1,
     ligne 200) — le constat de l'audit du 29/08/2026, qui tient toujours pour le front.
     Reporter la validation aux tickets BACK ne protège pas cette frontière : la vérification
     de forme des réponses reçues reste **à la charge du front**.
   *Reste à faire :* **BACK-1/2/3/4** — valider les corps entrants (frontière serveur).
   **FRONT-1/3/4/5** — vérifier la forme des réponses avant de s'y fier (frontière client),
   charge non couverte par le report ci-dessus. Voir aussi le §« Convention de codes HTTP »
   pour le rendu d'une réponse non conforme.

7. **« Nom de l'instance Jira » (FRONT-5) : résolu par la maquette, aucun champ ajouté.**
   *Décidé :* arbitrage produit du 31/08/2026 sur l'artboard « 3 — Récap » de la maquette
   Claude Design de référence (hors dépôt) — le Récap affiche sous « Jira » une valeur dérivée
   de l'`instanceUrl` saisie, pas `account.accountName`. Seule la **source** du champ est
   tranchée ; la **forme** de la dérivation reste à confirmer (voir *Reste à faire*). Aucun
   champ `instanceName` n'est ajouté au contrat ; `instanceUrl` existe déjà et suffit.
   *Reste à faire :* **FRONT-5** dérive l'affichage d'`instanceUrl`. La forme retenue — nom
   d'hôte seul, sans le schéma `https://` — est formulée comme probable par l'arbitrage, pas
   comme acquise : **FRONT-5 la confirme sur la maquette avant de l'implémenter.** Seul le
   formatage est concerné ; la source du champ, elle, est tranchée. Voir §« "Nom de l'instance
   Jira" de FRONT-5 ».

## Points ouverts issus de la revue de consommabilité du 31/08/2026

**Distincts des 7 décisions ci-dessus, qui restent closes.** Cette section recense les points
soulevés par la relecture de consommabilité du 31/08/2026 (`frontend-integrator`, écrans
FRONT-1 à FRONT-6) et **n'en rouvre aucune**. Aucun champ n'a été ajouté au contrat ni au
fichier de types à la suite de cette revue.

Deux natures à ne pas confondre :

- **Décision du décideur produit attendue** : points 5, 6, et l'arbitrage de fond du point 1
  (ce que l'avenant BACK-4 retient comme opération d'écriture).
- **Charges d'implémentation attribuées** : points 2, 3, 4, 7 — pas de décision produit
  requise, un porteur nommé et une ligne de ticket.

| # | Point | Nature | Porteur | Source |
| --- | --- | --- | --- | --- |
| 1 | Marqueur d'onboarding (lecture **et** écriture) | Décision produit + implémentation | BACK-4 (avenant) | FRONT-1 l.204, FRONT-5 l.293, FRONT-6 l.307 |
| 2 | Forme d'`instanceUrl` (normalisée ou telle que saisie) | Implémentation | BACK-4 + FRONT-5 | FRONT-5 l.292 |
| 3 | Rendu d'une réponse non conforme | Implémentation (+ copy) | FRONT-3 | FRONT-3 l.245, l.251 |
| 4 | Frontière de parsing côté front | Implémentation | FRONT-1/3/4/5 | FRONT-1 l.200 |
| 5 | Deux registres de libellé au bandeau | Décision produit (copy) | Décideur produit | FRONT-4 l.266 |
| 6 | Figma `not_connected` au Récap : pas de rendu en maquette | Décision produit (design) | Décideur produit | FRONT-5 l.288, FRONT-4 l.265 |
| 7 | ARCHI-2b prérequis de FRONT-5 | Ordonnancement | Orchestrateur | ARCHI-2b l.68, FRONT-5 l.292, l.296 |

1. **Manque bloquant B1 — marqueur d'onboarding, en lecture et en écriture.** Seul manque
   bloquant retenu par la revue. Conséquence assumée de la décision n°2, pas un défaut de
   l'amendement. Argumentaire complet et périmètre exact de ce que doit couvrir l'avenant :
   **voir la décision n°2**, non dupliqué ici. Porteur : **BACK-4** (avenant) ; l'arbitrage de
   fond — quelle opération d'écriture est retenue — revient au **décideur produit**.

2. **Forme d'`instanceUrl`, non tranchée.** `instanceUrl: string` ne garantit aucune forme,
   alors que FRONT-5 doit en dériver un nom d'hôte ; une chaîne sans schéma fait lever la
   dérivation. Les deux options et les comportements vérifiés à l'exécution :
   §« "Nom de l'instance Jira" de FRONT-5 ». Porteurs : **BACK-4** (forme persistée) et
   **FRONT-5** (dérivation). Aucun champ ajouté.

3. **Rendu d'une réponse non conforme.** Quand `res.ok === false` ou qu'un `200` arrive avec
   un corps vide, il n'y a pas de verdict et le front n'a aucun message de l'API, alors que
   FRONT-3 (ligne 251) exige que le message affiché en vienne. La conséquence est consignée au
   §« Convention de codes HTTP » : panne de transport distincte du verdict `error`
   (FRONT-3 ligne 245), aucune affirmation sur le jeton. Le libellé exact reste du copy,
   **non tranché**. Porteur : **FRONT-3**.

4. **Frontière de parsing côté front.** Le report de la décision n°6 ne vaut que pour la
   frontière serveur ; la vérification de forme des réponses reçues reste à la charge du
   front (FRONT-1 ligne 200, wizard resservi à un utilisateur configuré). Voir la décision
   n°6, reformulée sur ce point. Porteurs : **FRONT-1/3/4/5**.

5. **Divergence de design, à arbitrer par le décideur produit — hors contrat.** FRONT-4
   (ligne 266) donne un libellé de référence unique — « Impossible de terminer : le jeton du
   Modèle IA est invalide » — qui n'est atteignable que lorsque `lastError` est présent. Le
   bandeau aura donc **deux registres** : « X n'est pas connecté » (sans cause connue) et
   « X : message du backend » (avec cause). Le front refuse à juste titre de réutiliser le
   libellé « invalide » pour un jeton jamais saisi, ce que le §« Optionnel, et l'absence est
   une information » interdit. **C'est du copy, pas un manque d'API** : le contrat n'est pas
   en cause et aucun champ n'est requis.

6. **Divergence de design, à arbitrer par le décideur produit — hors contrat.** FRONT-5
   (ligne 288) ne prévoit que deux libellés de statut au Récap : `Connecté` et `Passé`. Or
   Figma peut y arriver en `not_connected` — l'utilisateur n'a ni connecté Figma ni cliqué
   « Passer cette étape », et Figma ne bloque jamais « Terminer » (FRONT-4 ligne 265). La
   maquette n'a pas de rendu pour cet état. **Le contrat est correct, c'est le design qui est
   muet.**

7. **Ordonnancement — ARCHI-2b est un prérequis de FRONT-5 autant que de FRONT-2.**
   `lib/providers-links.ts` (ARCHI-2b, ligne 68) n'est pas encore livré. Le contrat expose
   `provider: ProviderId`, c'est-à-dire un identifiant (`"anthropic"`), **pas un libellé
   affichable** (`"Anthropic"`). Sans cette table, FRONT-5 figerait le libellé en dur, ce que
   son critère d'acceptation (ligne 292, « pas de valeurs figées/statiques ») interdit. La
   liste de dépendances de FRONT-5 (ligne 296) ne cite pourtant que FRONT-4 et BACK-4.
   Porteur : **orchestrateur** — à corriger dans les dépendances de FRONT-5.

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
  (marqueur d'onboarding, cause d'échec persistée, `pending`) plutôt que comblés par des
  champs inventés — tranchés depuis, cf. §« Décisions actées le 31/08/2026 ».
- **Audit** — `qa-log-auditor`, 29/08/2026 :
  [`docs/qa-reports/2026-08-29-archi-2.md`](qa-reports/2026-08-29-archi-2.md). Un constat
  bloquant (garantie de non-exposition des jetons surestimée) corrigé ici même et dans
  l'en-tête du fichier de types. Constats « à surveiller » traités : `block` ajouté à
  `SaveSettingsResponse`, `RequiredConnectionStatus` supprimé. Les autres ont été consignés
  dans les questions ouvertes, ouverts sciemment ; ils sont tranchés depuis le 31/08/2026.
- **Arbitrage et validation finale** — `orchestrator`, 29/08/2026.

**Amendement du 31/08/2026 — clôture des 7 questions ouvertes.** Même ticket (ARCHI-2), pas
un nouveau. Portée : `lib/types/settings.ts` et ce document, aucun autre fichier.

- **Arbitrage produit** — Paul Lavergne (décideur produit), 31/08/2026 : les 7 décisions
  reprises au §« Décisions actées le 31/08/2026 », y compris la résolution de la question n°7
  sur l'artboard « 3 — Récap » de la maquette de référence.
- **Définition / application au contrat** — `backend-engineer`, 31/08/2026 : retrait de
  `TestConnectionPending`, ajout de `PersistedConnectionError` et de `lastError` sur les
  variantes `not_connected`, convention de codes HTTP actée, divergence assumée n°4 ajoutée,
  §Risque résiduel étendu à la persistance du message.
- **Relecture de consommabilité** — `frontend-integrator`, 31/08/2026, sur les six écrans
  FRONT-1 à FRONT-6. Verdict : **5 écrans sur 6 sont écrivables sans rien inventer** ; le lot
  complet reste non consommable à cause du seul manque bloquant B1 (marqueur d'onboarding),
  qui est une **conséquence assumée de la décision n°2 et non un défaut de l'amendement**. Les
  trois changements de l'amendement — retrait de `pending`, ajout de `lastError`, convention
  de codes HTTP — sont jugés un **gain net, sans régression**. Le narrowing de `lastError`
  fonctionne sans cast, et sa pose est bien refusée sur `connected` et sur `skipped` — refus
  vérifié sur littéral frais uniquement : comme tout contrôle de propriétés excédentaires, il
  tombe dès que la valeur transite par une variable (§Jetons). Méthode : sondes
  compilées hors dépôt (`tsc --noEmit --strict`), avec contrôle que les `@ts-expect-error`
  sont effectivement consommés. Le relecteur a fourni la liste des champs qu'il avait
  envisagés puis écartés ; **aucun champ n'a été ajouté au contrat à la suite de cette
  revue**. Points remontés : §« Points ouverts issus de la revue de consommabilité du
  31/08/2026 ».
- **Audit** — `qa-log-auditor`, 31/08/2026 :
  [`docs/qa-reports/2026-08-31-archi-2-amendement.md`](qa-reports/2026-08-31-archi-2-amendement.md).
  Verdict : **à surveiller, aucun bloquant** — 2 constats « à surveiller » et 5 mineurs,
  **tous corrigés avant le commit de cet amendement** (correctifs appliqués par
  `backend-engineer` le 31/08/2026, non re-audités). Les deux constats « à surveiller »
  naissent du correctif lui-même :
  1. une garantie locale d'absence de jeton, dans le commentaire de `JiraSettingsState`
     (« elle reste absente »), rendue fausse par l'ajout de `lastError` six lignes plus bas —
     réalignée sur la formulation déclarative de l'en-tête du fichier de types ;
  2. la convention de codes HTTP, généralisée ici aux trois endpoints, laissait indécidable
     le cas « configuration illisible » de `GET /api/settings` — tranché par l'orchestrateur
     (un échec de lecture rattrapé est un `200` avec `status: "error"`) et consigné au
     §« Convention de codes HTTP » comme extension de cohérence réversible, au même titre
     que la généralisation elle-même.

  L'audit a vérifié une à une les 23 références de ligne du diff — **toutes exactes** — et n'a
  trouvé **aucune donnée inventée ni aucune régression** sur les points déclarés levés le
  29/08/2026. Point de vigilance maintenu : la persistance d'une chaîne libre
  (§Risque résiduel), dont les charges sont nommément attribuées à BACK-1/2/3 et BACK-4.
- **Vérifications exécutées** — `pnpm run lint`, `pnpm exec tsc --noEmit` et
  `pnpm run build` passent. Aucun script `test` n'existe dans `package.json` ; aucun n'a été
  créé pour l'occasion.
