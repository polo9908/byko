# Stockage local chiffré des jetons

Ticket : **ARCHI-3** (`docs/tickets/phase-1-configuration.md`, lignes 82-100).
Implémentation faisant foi : [`lib/token-storage.ts`](../../lib/token-storage.ts) et
[`lib/secret.ts`](../../lib/secret.ts).

Ce document justifie les décisions. **En cas d'écart entre ce fichier et le code, c'est le
code qui fait foi** — ce document est alors à corriger.

## Décision en une page

| Quoi | Choix | Où |
| --- | --- | --- |
| Algorithme | `AES-256-GCM` via `node:crypto` (`createCipheriv` / `createDecipheriv`) | `lib/token-storage.ts` |
| Clé | 32 octets tirés de `randomBytes`, générée au premier **écrit**, jamais dérivée | `~/.bcc/master.key`, base64, `0600` |
| Coffre | Une enveloppe JSON par écriture : `{format, v, alg, iv, tag, ct}` | `~/.bcc/config.enc`, `0600` |
| Dossier | Créé à la demande | `~/.bcc`, `0700` |
| Nonce | 12 octets aléatoires, un par écriture | dans l'enveloppe (`iv`) |
| Intégrité | Tag GCM 16 octets + AAD `bcc-vault:1:aes-256-gcm` | dans l'enveloppe (`tag`) |
| Schéma des données | **Pas défini ici** : fourni par l'appelant (BACK-4) via `encode` / `decode` | `createEncryptedStore<T>` |
| Jeton en mémoire | Type `Secret` : la valeur n'est dans aucune propriété, l'affichage rend `••••4f2a` | `lib/secret.ts` |

Aucune dépendance ajoutée (contrainte ARCHI-1, ligne 30) : `node:crypto`, `node:fs/promises`,
`node:os`, `node:path` uniquement.

## Modèle de menace — ce que ce chiffrement protège, et ce qu'il ne protège pas

La note de cadrage du ticket (ligne 86) le dit sans détour : pour la menace d'aujourd'hui
— application locale, mono-utilisateur — `chmod 600` suffirait. Le chiffrement est conservé
au-delà de ce strict besoin **pour que la v2 multi-comptes n'ait pas à tout reconstruire**.
Il faut donc être précis sur ce qu'il apporte réellement, sous peine d'écrire une garantie
fausse — le défaut exact relevé en sévérité bloquante par l'audit du 29/08/2026 sur ARCHI-2.

**Ce que le chiffrement empêche aujourd'hui :**

- qu'un jeton soit lisible dans un fichier ouvert par accident, une capture d'écran, une
  session de partage d'écran, un `cat ~/.bcc/config.enc` en démonstration ;
- qu'un jeton parte en clair dans une **copie partielle** : sauvegarde, synchronisation ou
  archive qui emporterait le coffre sans la clé ;
- qu'une modification du fichier passe inaperçue : GCM authentifie, un octet changé fait
  échouer le déchiffrement au lieu de rendre des données douteuses.

**Ce qu'il n'empêche pas, et il faut le dire clairement :**

- **la clé est en clair, dans le même dossier que le coffre.** Qui peut lire `~/.bcc` peut
  lire les deux fichiers et déchiffrer. En v1, il n'existe ni compte, ni mot de passe, ni
  phrase de passe : il n'y a aucun secret dont dériver une clé et rien à demander à
  l'utilisateur. Prétendre que le coffre résiste à un attaquant local serait faux ;
- un processus tournant sous le même compte utilisateur (ou `root`) lit la mémoire du
  serveur Node, où les jetons transitent forcément en clair au moment d'appeler Jira,
  Figma ou le provider IA ;
- ni le fichier d'échange (swap), ni un vidage mémoire (core dump), ni une hibernation ne
  sont couverts.

En résumé : le chiffrement déplace la protection du jeton **du fichier vers le couple
fichier + clé**, et prépare le terrain pour la v2 où la clé, elle, pourra être protégée.
Il ne remplace pas les permissions POSIX, qui restent posées (`0700` / `0600`).

## Pourquoi AES-256-GCM

- **Chiffrement et authentification en une passe.** Un mode confidentiel seul (AES-CBC,
  AES-CTR) laisserait un fichier modifiable sans que rien ne le signale : un octet retourné
  dans le chiffré produirait un clair différent, et l'application déchiffrerait des données
  falsifiées. GCM porte un tag d'authentification ; toute altération fait échouer
  `decipher.final()` — vérifié, cf. §Vérifications. La solution alternative honnête serait
  AES-CBC + HMAC-SHA-256 en *encrypt-then-MAC*, mais elle demande deux clés, un ordre
  d'opérations facile à inverser, et une comparaison de MAC en temps constant écrite à la
  main. GCM donne la même propriété sans code à ne pas rater.
- **Disponible dans `node:crypto`, sans dépendance** (exigence du ticket, ligne 89, et
  contrainte ARCHI-1). `ChaCha20-Poly1305` est également fourni par Node et conviendrait
  tout aussi bien ; AES-256-GCM est retenu parce qu'il bénéficie de l'accélération
  matérielle AES-NI sur les machines de développement visées et qu'il est le choix le plus
  banal à relire. Ce n'est pas un choix contre ChaCha.
- **256 bits plutôt que 128** : la clé est tirée au hasard et jamais mémorisée par un
  humain, doubler sa taille ne coûte rien à l'usage.

### Les paramètres, un par un

- **Nonce (IV) de 12 octets, aléatoire, régénéré à chaque écriture.** 96 bits est la taille
  nominale de GCM : c'est la seule pour laquelle le nonce est utilisé tel quel, les autres
  passant par une dérivation interne (GHASH) sans bénéfice ici. Un nonce réutilisé avec la
  même clé casserait GCM (récupération du flux de clé et forge du tag) : il est donc tiré
  de `randomBytes` à chaque appel — jamais un compteur, qui serait à persister et donc à
  perdre. Le risque de collision d'un aléa de 96 bits ne devient sensible qu'à l'échelle de
  2³² écritures ; le coffre est réécrit à chaque sauvegarde de bloc, soit quelques dizaines
  de fois dans la vie d'une installation.
- **Tag de 16 octets** : longueur maximale de GCM, celle par défaut de Node — vérifiée
  plutôt que supposée (cf. §Vérifications). Aucune troncature.
- **AAD `bcc-vault:1:aes-256-gcm`** : les données associées sont authentifiées sans être
  chiffrées. Elles lient le chiffré à son format **et à sa version**. Sans elles, l'en-tête
  de l'enveloppe est un texte librement réécrivable ; avec elles, présenter un chiffré de
  version 1 sous un en-tête de version 2 (ou l'inverse, une fois la v2 écrite) fait échouer
  le déchiffrement au lieu de le faire interpréter selon les mauvaises règles.
- **Pas de fonction de dérivation de clé (scrypt, PBKDF2, Argon2).** Une KDF sert à
  transformer un secret **mémorisé par un humain** en clé. Il n'y en a pas en v1 : la clé
  est tirée directement d'un générateur cryptographique. Ajouter scrypt sur une clé déjà
  aléatoire n'ajouterait rien qu'un faux sentiment de solidité. C'est le point qui bouge en
  v2, et il est prévu : §Chemin d'évolution.

## Emplacement des fichiers

```
~/.bcc/                 0700   dossier de l'application
~/.bcc/config.enc       0600   coffre chiffré
~/.bcc/master.key       0600   clé de chiffrement, base64, 32 octets
```

- **Hors du dépôt**, donc jamais commité par accident, et **hors du répertoire de travail**,
  donc conservé d'une réinstallation à l'autre. C'est l'emplacement suggéré par le ticket
  (ligne 90).
- **Deux fichiers distincts** (exigence explicite du ticket, même ligne). Le gain réel est
  limité et il faut le nommer : une copie du dossier entier emporte les deux. Le gain porte
  sur la copie *partielle* — c'est-à-dire le cas courant d'un fichier de configuration
  envoyé, synchronisé ou joint à un rapport de bug.
- **Le chemin est un paramètre**, pas une constante : `defaultVaultLocation(baseDirectory?)`
  rend les trois chemins, et `createEncryptedStore({ location })` accepte n'importe quel
  emplacement. C'est ce qui rend le module vérifiable dans un dossier temporaire — et c'est
  le même point d'accroche que la v2 utilisera pour une clé par compte.
- **Les permissions sont appliquées en « meilleur effort »** : sur un système qui ne gère
  pas les modes POSIX (Windows, montage FAT), l'échec de `chmod` est ignoré plutôt que de
  rendre l'application inutilisable. Le chiffrement, lui, ne dépend pas du système de
  fichiers. C'est un arbitrage assumé : les permissions sont ici une couche de défense
  supplémentaire, jamais la protection principale.

### Écriture atomique

Chaque écriture passe par un fichier temporaire créé dans le même dossier en `0600`,
`fsync`é, puis déplacé par `rename` — atomique sur POSIX. À tout instant, `config.enc` est
soit l'ancien coffre complet, soit le nouveau. Sans cela, une coupure pendant l'écriture
laisserait un coffre tronqué, donc **indéchiffrable** : avec un format authentifié, un
fichier à moitié écrit n'est pas un fichier à moitié lisible, c'est une perte totale.

## L'interface : trois issues à la lecture, jamais deux

```ts
type VaultReadResult<T> =
  | { status: "loaded"; value: T }
  | { status: "absent" }
  | { status: "error"; kind: VaultErrorKind; message: string; code?: string };
```

**`absent` (premier lancement) et `error` (coffre présent mais illisible) ne doivent jamais
être confondus.** `docs/api-contracts.md` en fait une obligation côté API — une panne de
lecture rabattue sur « aucune configuration » resservirait l'onboarding à un utilisateur
déjà configuré (FRONT-1, ligne 200). Elle est plus grave encore côté stockage : après cette
confusion, la première sauvegarde **écrase** une configuration qu'on n'a pas su lire.

D'où deux choix de forme :

- pas de booléen `ok`. Avec `ok: boolean`, le raccourci
  `if (!result.ok) return "aucune configuration"` compile et fait exactement la faute
  ci-dessus. Avec trois variantes discriminées par `status`, l'oubli d'un cas se voit ;
- **aucune fonction de commodité** (`readOrNull`, `readOrDefault`, « rends-moi un objet vide
  si ça n'existe pas ») n'est exposée : elle recréerait la confusion en une ligne.

Un coffre vide n'est pas non plus un succès : un `config.enc` de 0 octet est rendu comme
`corrupted`, jamais comme `absent` ni comme une configuration vide (vérifié).

Les causes d'échec sont distinguées parce que la conduite à tenir diffère :
`permission_denied`, `key_missing`, `key_invalid`, `corrupted`, `unsupported_version`,
`decryption_failed`, `invalid_content`, `invalid_payload`, `io_error`. Chacune porte un
`message` en français qui dit ce que l'utilisateur peut faire — il est destiné à ressortir
tel quel dans la variante d'erreur de `GetSettingsResponse`.

### Une clé manquante ne se remplace jamais toute seule

Si le coffre existe et que `master.key` a disparu, la lecture renvoie `key_missing` et
**ne génère pas de nouvelle clé**. En générer une rendrait la perte définitive et
silencieuse : le coffre resterait là, indéchiffrable pour toujours, et le message d'erreur
parlerait d'un fichier « corrompu » alors qu'il est intact. La clé n'est créée que sur le
chemin d'écriture, avec le drapeau `wx` (échec si le fichier existe) pour qu'une écriture
concurrente ne remplace jamais une clé encore en usage.

### Le schéma des données n'est pas défini ici

`createEncryptedStore<T>({ encode, decode })` : le module chiffre un document JSON, il ne
sait pas ce qu'il contient. La forme des blocs Jira / Figma / IA, le marqueur d'onboarding
et `lastError` appartiennent à **BACK-4** — les écrire ici reviendrait à inventer le contenu
d'un ticket qui n'est pas écrit, dans le module le plus sensible du projet. `decode` est de
plus la frontière de parsing du coffre : son contenu vient du disque, où il a pu être écrit
par une version antérieure de l'application.

Une méthode `update(mutate)` sérialise lecture-modification-écriture. Elle existe pour une
raison précise : `POST /api/settings` sauvegarde bloc par bloc et deux requêtes peuvent être
en vol simultanément (`docs/api-contracts.md`, §`POST /api/settings`). Enchaîner soi-même
`read` puis `write` perd alors des écritures — mesuré : 25 mises à jour concurrentes en
`read` + `write` naïfs n'en conservent qu'**une**, contre 25 sur 25 avec `update`.

Cette sérialisation est une file d'attente locale au processus : si `mutate` ne se règle
jamais, la file reste bloquée pour toujours, y compris pour tout appel futur d'`update()` ou
de `write()` qui n'a rien à voir avec celui-là. `mutate` est donc borné à 30 secondes
(`UPDATE_MUTATE_TIMEOUT_MS`) : passé ce délai, l'appel en cours échoue en `invalid_payload`
et la file se débloque pour les suivants (défaut trouvé et corrigé le 04/09/2026, voir
§Audit QA — 04/09/2026). Le délai est large parce que `mutate` n'exécute qu'une
transformation en mémoire côté BACK-4, jamais un appel réseau.

## Le jeton en mémoire : `lib/secret.ts`

Le chiffrement couvre le disque. Les deux autres chemins de fuite nommés par le ticket
(ligne 91) — « ni dans les logs, ni dans une réponse `GET /api/settings` » — ne sont pas
couverts par le typage, et `docs/api-contracts.md` le dit noir sur blanc : un spread suffit
à faire voyager un jeton dans une réponse, sans la moindre erreur de compilation, et sans
que `lint`, `tsc` ni `build` ne le signalent.

Le type `Secret` ferme ces deux chemins **à l'exécution**. La valeur vit dans un champ privé
ECMAScript (`#value`) : elle n'est dans aucune propriété, donc invisible de `Object.keys`,
du spread, de `JSON.stringify` et de `util.inspect`. Les trois accidents ordinaires rendent
le masque :

```ts
console.log(secret);                    // Secret(••••4f2a)
console.log(`jeton=${secret}`);         // jeton=••••4f2a
NextResponse.json({ ...credentials });  // {"apiToken":"••••4f2a"}
```

**Limites, à lire avant de s'y fier :**

- la protection ne vaut que pour les valeurs **enveloppées**. Un jeton lu depuis
  `await request.json()` est une `string` nue : envelopper au plus tôt, à la frontière de
  parsing, est à la charge de BACK-1/2/3/4 ;
- `revealSecret()` rend la valeur en clair, par conception — les tests de connexion en ont
  besoin pour construire un en-tête HTTP. C'est la porte de sortie, unique et nommée pour
  être cherchable (`grep revealSecret`). **Cette unicité est une propriété fragile** : elle
  tient parce que `SecretBox` n'expose aucune méthode statique. La classe n'est pas exportée,
  mais `secret.constructor` la joint à l'exécution — une statique publique `reveal` y serait
  appelable en `secret.constructor.reveal(secret)`, sans passer par `revealSecret` et donc
  invisible du `grep`. C'était le cas à la livraison ; corrigé le 04/09/2026 en revue croisée
  (les accesseurs sont installés dans la portée du module par un bloc statique). Toute
  statique rajoutée à cette classe rouvrirait le chemin ;
- le masque montre les 4 derniers caractères (rien du tout en dessous de 12 caractères).
  Ce n'est **pas** une empreinte : deux jetons distincts peuvent porter le même masque, il
  ne doit jamais servir de clé d'identification ;
- côté écriture, un `Secret` oublié dans le document à persister ferait écrire son masque à
  la place du jeton — un coffre valide contenant un faux jeton, panne silencieuse qui ne se
  manifesterait qu'au test de connexion suivant. L'écriture est donc **refusée**
  (`invalid_payload`) et le message nomme le chemin fautif (`jira.apiToken`), jamais la
  valeur. Cette détection suit `JSON.stringify` jusqu'au bout : un objet dont le `toJSON()`
  renvoie un `Secret` non déballé est lui aussi refusé, pas seulement un `Secret` porté
  directement par une propriété — un défaut de ce type, trouvé le 04/09/2026, a été corrigé
  le jour même (§Audit QA — 04/09/2026).

## Aucun message n'est un canal de fuite

Aucune fonction de ces deux modules ne journalise quoi que ce soit, et **aucun message
d'erreur ne recopie l'exception d'origine**. Ce n'est pas une précaution de principe :

```
JSON.parse('{"apiToken": <jeton>}')
// Unexpected token 's', ..."piToken": sentinelle"... is not valid JSON
```

V8 recopie un extrait de son entrée dans les messages de `JSON.parse` (vérifié le
04/09/2026), et cette entrée est ici le **clair déchiffré**. Reprendre `error.message` dans
un message renvoyé au front — puis persisté par BACK-4 dans `lastError` — publierait un
morceau de jeton. Tous les messages sont donc rédigés en entier dans `lib/token-storage.ts` ;
des erreurs système, seul le code errno (`EACCES`, `ENOSPC`…) est repris.

Une exception levée par le `encode` ou le `decode` de l'appelant n'est pas recopiée non plus
(elle vient de code applicatif et peut porter un jeton) : le module renvoie un message
générique, à charge pour l'appelant de tracer sa propre exception s'il le souhaite.

`encode` est typé synchrone (`(value: T) => unknown`), mais `unknown` accepte aussi une
`Promise<unknown>` : rien à la compilation n'empêche de passer une fonction `async`. Sans
garde supplémentaire, le document persisté serait l'objet `Promise` lui-même —
`JSON.stringify` d'une Promise rend `"{}"` — un coffre valide et silencieusement vide. Un
`encode` qui renvoie une Promise est donc détecté à l'exécution et l'écriture refusée en
`invalid_payload`, sans l'attendre (défaut trouvé et corrigé le 04/09/2026, voir §Audit QA —
04/09/2026).

Même règle pour l'**inspection** du document à écrire : parcourir un objet exécute ses
accesseurs (`get`) et ses pièges de `Proxy`, qui sont eux aussi du code applicatif capable de
lever. À la livraison, une telle exception traversait `write()` telle quelle, avec son
message — le seul chemin par lequel une exception d'origine ressortait encore du module.
Corrigé le 04/09/2026 en revue croisée : l'écriture est refusée (`invalid_payload`) plutôt
que de persister un document qu'on n'a pas pu inspecter.

**Reste à la charge de BACK-4 :** le `message` que renvoie son `decode` ressort tel quel par
`GET /api/settings`. Même obligation de rédaction que pour BACK-1/2/3 (§Risque résiduel de
`docs/api-contracts.md`) : ni jeton, ni fragment de jeton, ni extrait du document déchiffré.

## Chemin d'évolution vers la v2 (clé par compte)

La note de cadrage demande que le mécanisme « puisse évoluer vers une clé par compte sans
tout reconstruire ». Ce qui est **déjà en place** pour cela, et utilisé aujourd'hui — donc
pas une promesse invérifiable :

1. **Le chiffrement est paramétré par la clé, pas par un emplacement.**
   `encryptDocument(key, document)` et `decryptDocument(key, envelope)` sont exportées et
   ne connaissent aucun fichier. Une clé par compte se branche sans les toucher.
2. **L'emplacement est une donnée.** `VaultLocation` porte les trois chemins ;
   `~/.bcc/master.key` devient `~/.bcc/accounts/<id>.key` par un simple changement de
   valeur, sans modifier la logique.
3. **L'enveloppe est versionnée, et la version est vérifiée.** Un lecteur qui rencontre une
   version inconnue le **dit** (`unsupported_version`, avec un message qui invite à mettre
   l'application à jour plutôt qu'à supprimer le fichier) au lieu de l'interpréter de
   travers. La version fait partie de l'AAD : une v2 ne pourra pas être relue comme une v1.
4. **Le schéma persisté appartient à l'appelant.** Ajouter une notion de compte ne demande
   pas de modifier le module de chiffrement.

Ce que la v2 devra **ajouter**, et qui n'est volontairement pas écrit aujourd'hui :

- une dérivation de clé depuis un secret d'utilisateur (`scrypt` de `node:crypto` fait
  l'affaire, toujours sans dépendance) — c'est ce qui protégerait enfin la clé elle-même,
  et cela n'a de sens qu'avec un compte, donc pas avant la v2 ;
- une enveloppe `v: 2` portant l'identifiant de clé, et la migration des coffres `v: 1` ;
- une rotation de clé, et la ré-écriture des coffres qu'elle implique.

## Limites connues

| Limite | Conséquence | Porteur |
| --- | --- | --- |
| La clé est en clair à côté du coffre | Aucune protection contre un attaquant local | v2 (KDF depuis un secret utilisateur) |
| Pas de verrou entre processus | Deux processus Node simultanés (`next dev` + `next start`) peuvent se perdre une écriture ; `update()` ne sérialise qu'à l'intérieur d'un processus | Non traité, à rouvrir si le besoin apparaît |
| Pas de rotation de clé | Une clé compromise impose de supprimer le coffre et de resaisir les jetons | v2 |
| Pas de suppression de jeton | Aucune opération « oublie mon jeton Jira » — reportée à **FRONT-12** (décision n°5 du 31/08/2026) | FRONT-12 |
| `chmod` en meilleur effort | Sur Windows / FAT, les modes ne sont pas appliqués ; seul le chiffrement protège | Assumé |
| Le message de `decode` est libre | Un jeton recopié dedans ressortirait par `GET /api/settings` | BACK-4 |
| Les jetons transitent en clair en mémoire | Inévitable : il faut la valeur pour appeler Jira, Figma ou l'IA | Assumé |
| Aucun test automatisé | Le comportement n'est vérifié que par des sondes jetables hors dépôt : une régression sur le chiffrement ou sur l'étanchéité de `Secret` ne serait rattrapée par rien en CI. Les nombreux défauts trouvés en revue croisée puis dans quatre passes d'audit QA le 04/09/2026 (détail : §Vérifications) sont précisément de ce type — silencieux, invisibles de `lint`/`tsc`/`build`, chacun manqué par la ou les sondes précédentes | À ouvrir (`node:test`, natif, zéro dépendance), **avant BACK-4** — recommandation explicite de l'audit QA du 04/09/2026 |
| Les lectures du document d'`encode()` doivent être pures | La garde (`findSecretPath`) et la sérialisation (`JSON.stringify`) lisent chacune le document indépendamment, sur le même objet — que ce soit via `toJSON`, un accesseur (`get`) ou un piège `Proxy`. Une lecture non déterministe pourrait montrer un graphe différent à chacune, et laisser passer un `Secret` non déballé (vérifié le 04/09/2026, y compris sans aucun `toJSON`) | `encode()` (BACK-4) : ne produire que des données JSON ordinaires, sans accesseur ni `Proxy` impur |

## Alternatives écartées

- **`chmod 600` seul, sans chiffrement** — suffirait pour la menace actuelle (note de
  cadrage), mais la v2 multi-comptes devrait alors tout reconstruire. Écarté par le ticket
  lui-même ; les permissions sont conservées **en plus** du chiffrement.
- **Librairie de chiffrement tierce** — interdite par ARCHI-1 (ligne 30) et par le ticket
  (ligne 89). `node:crypto` couvre le besoin.
- **Clé dans une variable d'environnement** (`BCC_SECRET_KEY` ou équivalent) — écartée :
  elle ne survivrait pas à un redémarrage sans que l'utilisateur la conserve lui-même
  quelque part, ce qui déplacerait le problème dans un `.env` non chiffré, souvent versionné
  par accident. Le ticket demande une clé « générée au premier lancement », pas fournie.
- **Trousseau du système d'exploitation** (Keychain macOS, libsecret) — c'est la vraie
  réponse au « la clé est en clair à côté du coffre », mais elle suppose soit une dépendance
  native, soit l'exécution d'un binaire système, et elle est spécifique à chaque plateforme.
  À reconsidérer en v2, où `VaultLocation` et la séparation clé/coffre lui laissent la place.
- **AES-CBC + HMAC-SHA-256** — même propriété d'authentification, mais deux clés, un ordre
  d'opérations facile à inverser et une comparaison de MAC à écrire à la main.

## Vérifications — 04/09/2026

Méthode : sonde jetable **hors dépôt** (aucun script de test n'existe dans ce projet ;
c'est la convention déjà suivie par ARCHI-2 et ARCHI-2b), exécutée sur Node v26.7.0 contre
les modules réels, dans un dossier temporaire. **83 vérifications, 83 passées.** Aucun jeton
réel n'a été utilisé : la sonde emploie une chaîne sentinelle inventée pour l'occasion.

Hypothèses sur `node:crypto`, vérifiées plutôt que supposées :

- `getAuthTag()` rend bien 16 octets par défaut ;
- une AAD différente, un tag falsifié ou un chiffré modifié d'un octet font échouer
  `decipher.final()` ;
- `createCipheriv("aes-256-gcm", …)` refuse une clé de 16 octets ;
- **`Buffer.from(texte, "base64")` est permissif** : `Buffer.from("!!!!", "base64")` rend un
  tampon vide sans lever. Un fichier de clé corrompu passerait donc pour une clé courte.
  D'où le décodage strict par ré-encodage canonique, appliqué à la clé comme à chaque champ
  de l'enveloppe ;
- les messages d'erreur de `JSON.parse` recopient un extrait de leur entrée (§ci-dessus).

Comportement du coffre, vérifié de bout en bout :

- le fichier écrit ne contient pas la chaîne sentinelle, et commence par `{"format":"bcc-vault"` ;
- IV et chiffré diffèrent à chaque écriture du même document (pas de déterminisme) ;
- modes obtenus après écriture : dossier `0700`, coffre `0600`, clé `0600`, clé de 32 octets
  en base64, exactement deux fichiers dans `~/.bcc`, aucun fichier temporaire résiduel ;
- premier lancement → `absent`, et **`read()` ne crée aucun fichier**, pas même la clé ;
- coffre relu après « redémarrage » (nouvelle instance de magasin) → `loaded` ;
- coffre de 0 octet → `corrupted` (jamais `absent`) ;
- coffre modifié d'un octet → `decryption_failed` ; mauvaise clé → `decryption_failed` ;
- clé supprimée, coffre présent → `key_missing`, **et aucune clé n'est regénérée** ;
- enveloppe `v: 2` → `unsupported_version` ; format ou algorithme étranger, champ manquant,
  base64 invalide ou de mauvaise longueur → `corrupted` ;
- `decode` qui refuse → `invalid_content` avec son message ; `decode` ou `encode` qui
  **lève** → erreur typée dont le message ne recopie rien de l'exception ;
- `Secret` non déballé dans le document → écriture refusée, message nommant `jira.apiToken`
  sans la valeur ;
- `update()` sur un coffre illisible → erreur, **et le coffre n'est pas écrasé** ;
- `update()` sur coffre absent → `current === undefined`, puis écriture ;
- 25 `update()` concurrents → 25 incréments conservés (contre 1 sur 25 en `read` + `write`
  naïfs) ;
- dossier impossible à créer → résultat d'erreur typé, aucune exception ne remonte.

`lib/secret.ts`, y compris après transpilation en ES2017 (la cible du projet, donc avec les
champs privés abaissés en `WeakMap`) : `Object.keys`, `Object.getOwnPropertyNames` et le
spread rendent le vide ; `JSON.stringify`, le littéral de gabarit et `util.inspect` (même
avec `showHidden` et `depth: 10`) rendent le masque ; `revealSecret` rend la valeur exacte ;
`isSecret` est faux pour un objet de forme identique écrit à la main.

Enfin : `pnpm run lint`, `pnpm exec tsc --noEmit --strict` et `pnpm run build` passent.

**Ces sondes ne sont pas reproductibles** : elles vivent hors du dépôt et disparaissent avec
la session. Sur un module de cette sensibilité, c'est une dette assumée et nommée, pas une
absence de vérification — voir §Limites connues, ligne « Aucun test automatisé ».

### Revue croisée indépendante — 04/09/2026

Seconde sonde, écrite indépendamment de la première par le relecteur, compilée depuis les
sources réelles (`tsc`, cibles **ES2017** *et* **ES2022**, pour couvrir les champs privés
abaissés en `WeakMap` comme les champs privés natifs) : **71 vérifications + 4 cas limites**.
Elle a reproduit l'essentiel des constats ci-dessus (round-trip, non-déterminisme de l'IV,
rejet du tag falsifié / du chiffré modifié / tronqué / vide / de l'IV modifié / de l'AAD
absente, `unsupported_version`, base64 non canonique, modes `0700`/`0600`, `absent` vs
`corrupted` vs `key_missing`, 25/25 en `update()` contre **1/25** en `read` + `write` naïfs,
absence de tout appel console et absence de la clé — en base64, en hexadécimal, et par
fenêtre glissante de 16 caractères — dans l'ensemble des messages d'erreur produits).

Elle a relevé **deux défauts, corrigés le jour même** :

1. **`secret.constructor.reveal(secret)` rendait le jeton en clair**, court-circuitant
   `revealSecret()` et donc le `grep` sur lequel repose la relecture d'audit. Reproduit sur
   les deux cibles de compilation. Corrigé : la classe n'expose plus aucune méthode statique
   (§Le jeton en mémoire).
2. **Une exception levée par un accesseur ou un `Proxy` du document à écrire traversait
   `write()` avec son message d'origine**, seul chemin restant par lequel un message
   applicatif — donc potentiellement un jeton — ressortait du module. Corrigé : l'écriture
   est refusée en `invalid_payload` (§Aucun message n'est un canal de fuite).

### Audit QA — 04/09/2026

Troisième sonde, indépendante des deux précédentes, exécutée par `qa-log-auditor` avant
commit : **111 vérifications passées, 2 échouées.** Les deux échecs étaient un même type de
défaut que la revue croisée venait de corriger ailleurs — une garantie annoncée qui ne
tenait pas dans un cas non testé jusque-là — et ont été corrigés le jour même :

1. **La détection du `Secret` non déballé suivait le graphe brut de l'objet, pas le graphe
   que `JSON.stringify` sérialise réellement.** Un objet dont le `toJSON()` renvoie un
   `Secret` (`{ toJSON() { return { apiToken: secret } } }`) passait la garde — invisible
   sur le graphe brut, qui ne voit qu'une fonction `toJSON` — puis `JSON.stringify` appelait
   cette méthode et écrivait le masque : exactement le « coffre valide contenant un faux
   jeton » que la garde existe pour empêcher. Corrigé : la détection déroule `toJSON()`
   avant d'inspecter un nœud, dans le même ordre que `JSON.stringify` — mais teste `isSecret`
   **avant** de dérouler, à chaque niveau, pour ne pas se faire piéger par le `toJSON()` du
   `Secret` lui-même, qui renvoie son propre masque (§Le jeton en mémoire).
2. **`encode` pouvait être `async` sans erreur de compilation**, et une Promise oubliée
   comme document persistait `"{}"` sans le signaler (§Aucun message n'est un canal de
   fuite). Corrigé par une détection à l'exécution, en amont du chiffrement.

Au passage, la file d'attente d'`update()` s'est révélée bloquable indéfiniment par un
`mutate` qui ne se règle jamais, geste silencieusement toute écriture ultérieure du
processus. Ce n'est pas un défaut de la même famille (aucune fuite), mais le même principe
d'un module qui ne doit rien laisser dans un état indéfini s'applique : `mutate` est
désormais borné à 30 secondes (§Le schéma des données n'est pas défini ici).

L'audit a aussi relevé, en « mineur », une asymétrie qui n'avait pas été vue jusque-là :
`master.key` était écrite sans `fsync`, alors que le coffre l'est explicitement
(§Écriture atomique) — le seul chemin du module vers une perte que lui-même documente
comme irréversible (une clé perdue n'a, par construction, aucune version antérieure sur
laquelle retomber). Corrigée dans la foulée : la clé est désormais ouverte, écrite puis
explicitement synchronisée avant fermeture, sur le même modèle que `writeAtomically`.

Revérifié après ces trois correctifs : `pnpm run lint`, `pnpm exec tsc --noEmit --strict` et
`pnpm run build` passent ; les trois scénarios (contournement par `toJSON`, `encode`
asynchrone, file bloquée) rejoués et corrects.

### Deuxième défaut sur `toJSON` — le correctif ci-dessus était encore infidèle

Une seconde passe d'audit QA a rejoué le correctif du point 1 ci-dessus et l'a trouvé
**encore bloquant**, sur le point précis qu'il prétendait fermer. La première version
déroulait `toJSON()` **en boucle** sur la valeur résolue, tant qu'elle en exposait un
nouveau. `JSON.stringify` ne fait pas ça : il n'appelle `toJSON` **qu'une seule fois**, sur
la valeur obtenue d'un accès de propriété donné (`SerializeJSONProperty`, ECMA-262
§25.5.2.1), et ne rappelle plus jamais `toJSON` sur ce que cet appel renvoie — sauf si ce
retour est lui-même relu plus bas comme la valeur d'une propriété. Deux conséquences
vérifiées le 04/09/2026 :

- **Un `Secret` porté par une propriété ordinaire du retour d'un `toJSON` intermédiaire
  passait quand même la garde.** `{ toJSON: () => ({ apiToken: secret, toJSON: () => "safe" }) }`
  — la boucle re-déroulait le `toJSON` du retour (`"safe"`) au lieu de descendre dans ses
  propriétés, où `JSON.stringify`, lui, trouve et sérialise bien `apiToken`. Le coffre était
  donc écrit, valide, contenant le masque.
- **Un `toJSON` qui renvoie un objet neuf à chaque appel ne terminait jamais**
  (`{ toJSON: () => fresh() }`, `fresh()` recréant l'objet à chaque appel) : le `WeakSet`
  anti-cycle ne retient que des objets déjà vus, et chaque itération de la boucle en
  produisait un nouveau. `JSON.stringify` du même document termine instantanément, pour la
  même raison que le point précédent — un seul appel à `toJSON`, jamais une boucle.

Corrigé en remplaçant la boucle par une résolution fidèle à l'algorithme réel :
`resolveJSONValue(value, key)` appelle `toJSON` **une fois**, avec la clé de la propriété
d'où la valeur vient (chaîne vide à la racine, index en chaîne dans un tableau) ; son
résultat n'est jamais re-résolu au même niveau, seulement descendu par la récursion
normale sur ses propres propriétés. `isSecret` reste testé sur la valeur BRUTE avant
résolution (même raison qu'au point précédent : le `toJSON` d'un `Secret` renvoie son
propre masque) et sur la valeur RÉSOLUE (cas d'un `toJSON` intermédiaire qui renvoie un
`Secret` directement, sans propriété intermédiaire).

Revérifié : les deux scénarios ci-dessus, plus les cas déjà couverts (`Secret` direct à la
racine, `Secret` dans une propriété simple, `toJSON` bénin) — tous corrects. `pnpm run lint`,
`pnpm exec tsc --noEmit --strict` et `pnpm run build` passent.

### Troisième défaut sur `toJSON` — les valeurs appelables, et un invariant documenté

Une troisième passe d'audit QA a rejoué le correctif ci-dessus sur 4000 documents aléatoires
et trouvé un dernier écart : `resolveJSONValue` ne considérait comme candidates à `toJSON`
que les valeurs `typeof … === "object"` (plus `bigint`). Or ECMA-262 §25.5.2.1 teste
« value est un `Object` », et **une fonction est un `Object`** — elle peut donc porter un
`toJSON` qu'elle-même n'expose pas comme propriété énumérable ordinaire, et que
`JSON.stringify` appelle malgré tout (vérifié le 04/09/2026 :
`JSON.stringify({ a: Object.assign(() => {}, { toJSON: () => ({...}) }) })` sérialise le
retour de `toJSON`, pas `{}`). Une fonction augmentée d'un `toJSON` renvoyant un `Secret`
échappait donc à la garde — sur l'échantillon de l'audit, 889 documents sur 4000 en fuyaient
un dès que cette forme apparaissait. Corrigé en une ligne : `resolveJSONValue` teste aussi
`typeof value === "function"`.

Le même audit a signalé, sans le classer bloquant, un dernier écart structurel : la garde
(`findSecretPath`) et la sérialisation (`JSON.stringify(document)`, juste après) appellent
chacune `toJSON` **indépendamment**, sur le même document. Un `toJSON` non déterministe
(deux appels, deux résultats différents) pourrait donc montrer un graphe sans `Secret` à la
garde et un `Secret` au sérialiseur. Le fermer complètement demanderait de fusionner les deux
parcours en un seul (par exemple un `replacer` de `JSON.stringify` qui inspecte au passage) —
une réécriture plus large, à son tour porteuse d'un risque de divergence inédite, sur un
module qui vient d'en corriger trois de suite. Choix retenu : documenter l'invariant plutôt
que réécrire une quatrième fois sous pression. **`encode()` (BACK-4) ne doit produire que des
données JSON ordinaires ; si elle fournit des `toJSON` personnalisés, ils doivent être purs**
(même retour à chaque appel) — ligne ajoutée au code et au tableau ci-dessous.

Revérifié après ce troisième correctif : les scénarios des deux passes précédentes, plus le
nouveau (fonction porteuse d'un `toJSON`, à la racine et en profondeur), plus une fonction
sans `toJSON` qui doit rester absente du document (comme un vrai `JSON.stringify` l'omet) —
tous corrects. `pnpm run lint`, `pnpm exec tsc --noEmit --strict` et `pnpm run build`
passent.

### Quatrième passe — l'invariant élargi aux accesseurs et aux pièges `Proxy`

Une quatrième passe d'audit QA a confirmé le code correct (`6000` documents aléatoires,
`0` fuite), mais a relevé que l'invariant écrit ci-dessus ne nommait que `toJSON` — alors
que la même divergence entre la garde et `JSON.stringify` se reproduit **sans aucun
`toJSON`**, avec un simple accesseur (`get`) ou un piège `get`/`ownKeys` de `Proxy` impur.
Le module le savait déjà en pratique (la garde protège explicitement contre une exception
levée par l'un ou l'autre), mais ne le disait pas au bon endroit : un `BACK-4` qui n'écrit
aucun `toJSON` aurait pu croire l'invariant hors sujet. Reformulé, dans le code comme dans
le tableau §Limites connues, pour nommer les trois mécanismes.

`app/api/` n'existe toujours pas et n'est pas créé ici. ARCHI-3 pose le mécanisme ;
**`GET /api/settings` et `POST /api/settings` sont BACK-4**. Le critère d'acceptation
« `GET /api/settings` renvoie un statut par connexion mais jamais la valeur du jeton »
(ligne 95) est donc tenu ici comme une contrainte de conception, sur trois points :

1. le module rend un `T` défini par BACK-4 — et le contrat d'ARCHI-2 ne déclare aucun champ
   jeton dans `SettingsState` ;
2. la seule sortie en clair exposée par `lib/secret.ts` est `revealSecret()`, qui se cherche
   en une commande — sous la réserve nommée au §Limites ci-dessus : la classe ne doit porter
   aucune méthode statique, faute de quoi `secret.constructor` en rouvre une seconde ;
3. si un jeton enveloppé atteignait malgré tout une réponse JSON, c'est son masque qui
   partirait.

Le reste — construire les réponses champ par champ, ne jamais réutiliser un objet portant
des credentials — demeure une obligation d'implémentation de BACK-1/2/3/4, énoncée au
§Jetons de `docs/api-contracts.md`. **Ce mécanisme ne dispense d'aucun contrôle en sortie.**
