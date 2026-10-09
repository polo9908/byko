# Diffusion — installeurs macOS et Windows, mise à jour automatique

## Publier une version

1. Monter `version` dans `package.json`, committer sur `main`.
2. Pousser une étiquette : `git tag v0.1.1 && git push origin v0.1.1`.
3. Le flux `.github/workflows/release.yml` construit sur macOS et Windows et publie dans une **release GitHub en brouillon**
   les installeurs (`.dmg`, `.exe`) et les fichiers de mise à jour (`latest-mac.yml`, `latest.yml`, `.zip`, `.blockmap`).
4. Relire la release puis la **publier** : c'est seulement là que les apps installées la voient.

Build local sans publier : `npm run build:mac` ou `npm run build:win` (résultat dans `dist/`).

## Secrets à renseigner dans le dépôt GitHub (Settings > Secrets and variables > Actions)

| Secret | Rôle |
|---|---|
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Certificat « Developer ID Application » exporté en `.p12`, encodé en base64, et son mot de passe (compte Apple Developer). |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarisation Apple (mot de passe d'application créé sur appleid.apple.com). |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Certificat de signature de code Windows (`.pfx` en base64). Facultatif pour une première bêta. |

Sans ces secrets, le flux produit quand même des installeurs, **non signés** :

- macOS refuse d'ouvrir l'app chez un tiers, et la mise à jour automatique ne fonctionne pas (elle exige une app signée) ;
- Windows installe l'app après un avertissement SmartScreen ; la mise à jour automatique fonctionne, mais **sans
  vérification de signature** : seule l'empreinte publiée dans la même release authentifie le paquet. Quiconque peut
  publier une release sur le dépôt peut donc pousser du code aux apps installées. Acceptable pour une bêta fermée tant que
  le dépôt n'a qu'un seul mainteneur ; à trancher (certificat, ou mise à jour manuelle sous Windows) avant d'élargir.

Aucun de ces secrets ne vit dans le dépôt ni dans `.env`.

## Mise à jour automatique (`src/main/updater.ts`)

- Active uniquement sur l'app installée (`app.isPackaged`). Première vérification 15 s après le lancement, puis toutes les 6 h.
- Source fixée au build par `publish` (`electron-builder.yml`) : les releases publiées de `polo9908/byko`. Ni le renderer ni un
  réglage ne peuvent la changer ; aucun canal IPC.
- Téléchargement en arrière-plan, installation à la fermeture de l'app. Pas de retour en arrière de version.
- Un échec (hors ligne, release absente, app non signée) est tracé par le nom de l'erreur seulement (le journal détaillé
  d'electron-updater est coupé) et n'affecte pas l'usage.
- Rien n'est affiché à l'utilisateur : ni progression, ni « redémarrer pour mettre à jour ».

## Contenu de l'installeur

Liste blanche dans `electron-builder.yml` : `out/`, `resources/`, `package.json` et les dépendances de production. Ni sources,
ni docs, ni outils internes, ni `.env`.

## Nom et dossier de données

L'app s'appelle « Byko » (installeur, titre, textes). Son **nom interne reste « BYKO »** (`app.setName` au démarrage,
`src/main/index.ts`) : sur macOS, la clé de chiffrement des jetons vit dans le trousseau sous « BYKO Safe Storage », et
le dossier de données est `…/BYKO`. Changer ce nom interne rendrait illisibles les jetons des installations existantes.

**Ne jamais lancer une app empaquetée pour un essai sur un poste qui a déjà un profil** : sur macOS, changer `HOME` ne
déplace pas le dossier de données ; l'app ouvre le vrai profil.

## Non fait

- Aucune release n'a encore été publiée ; le flux GitHub n'a jamais tourné.
- Le build Windows n'a pas été essayé (seul l'empaquetage macOS arm64 non signé l'a été, en local).
- Electron 33 : à monter avant une diffusion large.
- Le paquet macOS pèse environ 570 Mo (moteur de transcription embarqué pour toutes les plateformes) : à alléger.
