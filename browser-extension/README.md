# Extension navigateur BYKO

Pont entre BYKO et le navigateur. **Phase ② du chantier** : elle ne fait
qu'ouvrir un canal vers BYKO et répondre à ses pings.

Conception et contrat : `docs/ipc/browser-automation.md`.
Design de la phase ② : « le pont seul, aucune recette ».

## Ce que cette extension ne fait pas

- Elle ne lit aucune page : aucune permission d'hôte n'est déclarée, donc elle en
  est techniquement incapable.
- Elle n'automatise rien, pour l'instant.
- Elle n'accède à aucun secret.

## Prérequis

- macOS ou Linux. Windows demanderait que le manifeste hôte pointe vers un
  exécutable natif, pas un script shell — hors périmètre de cette phase.
- Chrome 105 ou plus (le maintien en vie du service worker par un port de
  messagerie native date de cette version).

## Installation

```sh
npm run build              # produit out/main/nativeHost.js
npm run install:native-host # écrit le lanceur et le manifeste hôte de Chrome
```

Le script affiche l'identifiant attendu de l'extension. Ensuite :

1. Ouvrir `chrome://extensions` et activer **Mode développeur**.
2. **Charger l'extension non empaquetée** → choisir ce dossier (`browser-extension/`).
3. Vérifier que l'identifiant affiché par Chrome correspond à celui du script.
   S'il diffère, relancer `npm run install:native-host` après avoir déplacé ou
   renommé le dossier : l'identifiant d'une extension non empaquetée est dérivé
   de son chemin absolu.
4. Redémarrer Chrome (Chrome lit les manifestes hôtes au démarrage), puis lancer
   BYKO.

## Vérifier que le pont fonctionne

Au lancement de BYKO, la console du processus main doit afficher :

```
[browser-automation] à l'écoute (/…/Application Support/BYKO/browser-automation.sock)
[browser-automation] extension connectée
[browser-automation] extension connectée (version 0.1.0)
[browser-automation] aller-retour confirmé en 3 ms
```

Et dans le service worker de l'extension (`chrome://extensions` → **Service
worker**), `[byko] connecté à BYKO`.

Si seul le premier message apparaît, l'extension n'est pas connectée : vérifier
l'identifiant, l'emplacement du manifeste hôte, et que Chrome a bien redémarré.

## Limites connues de cette phase

- La reconnexion après un redémarrage de BYKO repose sur un `setTimeout` du
  service worker, que Chrome peut terminer avant qu'il ne se déclenche. Un
  réveil fiable demandera l'API `alarms` — travail ultérieur.
- Le helper est lancé via un script shell et le binaire Electron du projet : cela
  suffit pour développer, mais la distribution demandera un exécutable dédié
  signé et notarisé.
- Une seule connexion est acceptée à la fois ; les suivantes sont fermées.

## Outil de maintenance — relevé de structure d'une page

Sert à écrire les sélecteurs d'une recette à partir des pages réelles, au lieu de
les inventer. Jamais actif en usage normal.

```sh
npm run build
BYKO_RECON_URL_PREFIX=https://console.cloud.google.com/ npx electron .
```

La valeur est une **liste de préfixes d'URL séparés par des virgules**, pas
forcément des domaines : viser `https://console.cloud.google.com/projectcreate`
relève cette page précise. On peut donc relever plusieurs onglets ouverts en une
seule exécution.

```sh
BYKO_RECON_URL_PREFIX="https://console.cloud.google.com/auth/overview,https://console.cloud.google.com/auth/audience" npx electron .
```

**À savoir sur la console Google** : ses pages `/auth/*` sont liées à un projet.
Ouvertes sans `?project=…`, elles sont redirigées vers un sélecteur de projet — et
le relevé ne trouve alors aucun onglet correspondant, ce qui se manifeste par
`reconFailed: aucun onglet ouvert sur …`. Ouvre-les avec le paramètre, par
exemple `https://console.cloud.google.com/auth/overview?project=mon-projet`.

BYKO demande alors à l'extension de relever l'onglet **que tu as ouvert toi-même**
correspondant à ce préfixe, puis écrit le résultat dans un fichier
`recon-<horodatage>.json` à la racine des données de l'application
(`~/Library/Application Support/BYKO/`). Rien n'est navigué, rien n'est rempli,
rien n'est cliqué.

**Ce que le relevé contient** : pour chaque élément interactif visible, sa balise,
son rôle, son libellé (tronqué), une proposition de sélecteur, et une liste fermée
d'attributs — `id`, `aria-*`, `name`, `type`, `placeholder`, `jsname`,
`data-testid`.

**Ce qu'il ne contient jamais** : la valeur d'un champ. Le code ne lit pas
`.value`, uniquement des attributs sur liste blanche.

**La limite à connaître** : si une page *affiche* un secret en texte visible — ce
qui arrive sur l'écran qui vient de créer un client OAuth — ce texte peut se
retrouver dans le relevé, puisqu'il fait partie de la page. Pour cette page-là :
crée un **client jetable**, relève, puis supprime le client.

Toute modification du code de l'extension demande un rechargement dans
`chrome://extensions` — Chrome ne le fait pas tout seul pour une extension non
empaquetée.
