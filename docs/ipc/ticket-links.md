# Contrat IPC — Liaison ticket ↔ pull request ↔ maquette ↔ release

Les tickets Jira **créés pendant un point d'équipe** (`jira:createIssue`) sont suivis par main et reliés seuls à leurs
pull requests GitHub, à leurs maquettes Figma et à la release qui les livre. Second temps : le ticket est mis à jour
quand la pull request est fusionnée ou la maquette validée.

Code : `src/main/linkSync.ts` (moteur), `src/main/ticketLinks.ts` (stockage), `src/main/integrations/{github,forge}.ts`,
`src/shared/links.ts` (types). Arbitrages du 8 octobre 2026.

## Règles de rapprochement (déterministes, sans IA)

| Lien | Règle |
|---|---|
| Pull request | La clé du ticket (« PROJ-123 ») figure dans le **nom de la branche, le titre ou la description**. Insensible à la casse ; « PROJ-1 » ne correspond ni à « PROJ-12 » ni à « XPROJ-1 ». |
| Maquette | La clé figure dans le **nom d'une page, d'une section ou d'un cadre** d'un fichier Figma suivi (3 niveaux de profondeur). |
| Maquette validée | Statut Dev Mode du nœud : `READY_FOR_DEV` (ou `COMPLETED`). |
| Release | Première release publiée après la fusion dont le tag **contient le commit de fusion** (comparaison `commit...tag` = `ahead`/`identical`), pas la date seule. |

## Ce que BYKO écrit sur Jira

| Évènement | Action | Journal |
|---|---|---|
| Nouvelle PR / maquette / release reliée | Lien distant du ticket (`remotelink`, idempotent par `globalId`) | « fait seul », **annulable** (`jira-remote-link`) : le lien est retiré et n'est plus reposé |
| PR fusionnée, maquette validée, release publiée | Commentaire sur le ticket | « fait seul », **annulable** (`jira-comment`) |
| Toutes les PR reliées sont fusionnées | Passage du ticket à un statut « terminé » | Selon l'autonomie « Statut des tickets » (`statut-tickets`, C3) : fait seul si la catégorie est autonome, sinon **proposé** et validé par l'utilisateur. Chaque validation avance la catégorie d'un cran. Non annulable. |

Chaque action n'est faite **qu'une fois** par ticket, et inscrite sur disque action par action.
- **Lien distant** : idempotent côté Jira (`globalId`), fait puis inscrit ; non inscrit, il est reposé à l'identique.
- **Commentaire** : jamais posté deux fois. Inscrit « en cours » avant l'envoi, « fait » après. Un refus net de Jira le
  désinscrit (retenté au passage suivant). Resté « en cours » (app quittée pendant l'envoi, délai dépassé), il n'est pas
  renvoyé : il est **signalé** 7 jours dans les erreurs de synchronisation, à vérifier à la main sur le ticket.
- Une entrée de journal qui ne peut pas être écrite est signalée, sans refaire l'action.
- Un ticket que Jira dit introuvable est signalé et n'est retiré du suivi qu'après 7 jours d'affilée.
- Une réponse à une proposition de changement de statut donnée pendant un passage n'est pas écrasée par lui.

BYKO n'écrit **jamais** sur GitHub ni sur Figma (lecture seule).

## Détection

BYKO n'a pas de serveur, donc pas de webhook : main relève les sources **toutes les 5 minutes** tant que l'app est
ouverte et qu'un compte est connecté (premier passage 20 s après le démarrage), et à la demande (`links:sync`).
Une fusion faite app fermée est vue au prochain lancement. Limites : 100 pull requests les plus récemment mises à jour
par dépôt, tickets suivis 120 jours (200 au plus), release cherchée pendant 60 jours après la fusion.

## Canaux

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `github:openTokenPage` | `github.openTokenPage()` | — | ouvre la page de jeton (URL fixée dans main) |
| `github:connect` | `github.connect(token)` | jeton (chaîne non vide) | `{ connected, login? }` — le jeton ne revient jamais |
| `github:getStatus` / `github:disconnect` | idem | — | statut / rien |
| `links:getState` | `links.getState()` | — | `LinksState` |
| `links:sync` | `links.sync()` | — | `LinksState` après un passage complet |
| `links:addRepo` | `links.addRepo(repo)` | `propriétaire/dépôt` ou adresse du dépôt (≤ 300 car.) | `LinksState` |
| `links:removeRepo` | `links.removeRepo(repo)` | nom du dépôt | `LinksState` |
| `links:addFigmaFile` | `links.addFigmaFile(file)` | lien ou clé du fichier (≤ 300 car.) | `LinksState` |
| `links:removeFigmaFile` | `links.removeFigmaFile(key)` | clé du fichier | `LinksState` |
| `links:resolveTransition` | `links.resolveTransition(issueKey, accept)` | clé Jira valide, booléen strict | `LinksState` |
| `links:updated` (main → renderer) | `links.onUpdated(cb)` | — | `LinkEvent[]` du passage (vide si rien de neuf) |

## Frontière de sécurité

- **Aucune URL ne vient du renderer.** Pour un dépôt ou un fichier Figma, le renderer envoie une saisie dont main
  n'extrait qu'un **identifiant** validé (`propriétaire/dépôt` par motif strict, « . » et « .. » exclus ; clé Figma
  alphanumérique). Main reconstruit lui-même l'adresse appelée, toujours sur `api.github.com` / `api.figma.com`, et
  vérifie l'accès avant d'enregistrer.
- Les URL renvoyées au renderer (PR, release, maquette) sont en `https://` et, pour GitHub, limitées à
  `https://github.com/` ; celles de Figma sont construites par main. Elles s'ouvrent par le gestionnaire de fenêtre
  existant (`shell.openExternal`, https uniquement).
- Jeton GitHub : rogné et validé par motif (`[A-Za-z0-9_]{20,255}`) **avant tout envoi** ; une erreur de `fetch`
  (dont le message peut citer l'en-tête d'autorisation) n'est jamais relayée, seul un message fixe remonte. Appels
  bornés par un délai (20 s GitHub/Jira, 30 s Figma).
- Jeton GitHub : `safeStorage` via `secrets.ts` (clé `github.credentials`), par compte. Jeton « fine-grained » en
  **lecture seule** recommandé (« Pull requests » et « Contents »).
- Le suivi des tickets est tenu par main dans les handlers `jira:createIssue` / `updateIssueSummary` / `deleteIssue` :
  le renderer ne déclare pas lui-même ce qui est suivi. Un échec du suivi ne fait jamais échouer l'action Jira.
- Stockage : `ticket-links.json` dans le dossier du compte (données métier, pas de secret), écriture atomique,
  relu champ par champ ; illisible → mis de côté, jamais supprimé. Chaque passage est lié au compte actif à son
  démarrage ; ses évènements ne sont envoyés à la fenêtre que si ce compte est toujours affiché.
- Aucun appel à l'IA : l'interrupteur « Utiliser l'IA » n'a pas d'effet ici.

## Non fait

- **GitLab** : l'interface `Forge` est prête, l'intégration reste à écrire.
- Les tickets créés en réunion **avant** cette version ne sont pas suivis.
- Jamais exécuté contre de vrais comptes GitHub/Figma/Jira : moteur vérifié hors app avec des API simulées.
