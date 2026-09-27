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
  réveil fiable demandera l'API `alarms` — travail de la phase ③.
- Le helper est lancé via un script shell et le binaire Electron du projet : cela
  suffit pour développer, mais la distribution demandera un exécutable dédié
  signé et notarisé.
- Une seule connexion est acceptée à la fois ; les suivantes sont fermées.
