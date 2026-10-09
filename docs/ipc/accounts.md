# Contrat IPC — Comptes locaux, déconnexion, connexion rapide

Plusieurs comptes sur un même appareil. **Chaque compte a son dossier** `userData/accounts/<uuid>/` : ses secrets chiffrés
(`secrets.json` : Jira, IA, Figma, Google Agenda, e-mail), son journal, ses décisions de réunion, son vocabulaire, ses
réglages de confidentialité et d'autonomie. Changer de compte ne mélange rien. Les modèles vocaux, eux, restent communs.

Registre : `userData/accounts.json` = `{ accounts: uuid[], activeId: uuid | null }`. Aucun e-mail, aucun jeton dedans.
Au premier lancement après cette version, les fichiers existants sont **déplacés** (rename) dans le premier compte.

| Canal | `window.api.accounts.*` | Entrée | Effet |
|---|---|---|---|
| `accounts:list` | `list()` | — | `AccountSummary[]` : `{ id, email?, active, connectors[] }` (noms des connexions, jamais de valeur) |
| `accounts:switch` | `switchTo(id)` | uuid connu | **Connexion rapide** : le compte devient actif |
| `accounts:add` | `add()` | — | nouveau compte vide, actif : l'assistant de démarrage s'ouvre |
| `accounts:logout` | `logout()` | — | plus de compte actif ; **rien n'est supprimé** |
| `accounts:remove` | `remove(id)` | uuid connu | supprime ses jetons et ses données |

- Validation : l'`id` doit être un UUID présent dans le registre (`assertKnownAccount`), donc aucun chemin ne vient du renderer.
- Après `switch` / `add` / `logout` / `remove`, main **recharge la fenêtre** (`reloadIgnoringCache`) et vide les caches liés
  au compte (tickets Jira de `assistant:suggest`, connexion Google en cours). Aucun état de l'ancien compte ne survit.
- Sans compte actif, tout accès à un secret ou à une donnée est refusé (« Aucun compte connecté. »).
- `profile:get` renvoie `signedIn: false` après une déconnexion : l'app affiche « Choisir un compte » au lieu de la vue journée.
- Un compte jamais configuré (ni e-mail ni connexion), laissé par un « Ajouter un compte » abandonné, est supprimé au
  changement de compte suivant.
- Un seul compte actif à la fois ; pas de chiffrement différent par compte (même trousseau du système).
