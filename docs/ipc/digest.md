# Contrat IPC — Digest de la vue journée

Sous le titre de la vue journée : les quelques points à regarder aujourd'hui, choisis selon le rôle du compte
(`docs/ipc/profile.md`). Aucun point : l'écran reste « Rien ne dépend de vous. ».

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `digest:get` | `digest.get()` | — | `DailyDigest` : `{ role?, items }`, 4 points au plus |

## Les points

Chaque ligne est un fait constaté dans une source ; rien n'est déduit par l'IA, aucun appel au fournisseur d'IA.

| Type | Fait | Source | Au clic |
|---|---|---|---|
| `blocker` | « X bloque N tickets » : liens Jira « Blocks » vers des tickets non terminés | Jira | le ticket |
| `blocked` | « X attend Y » | Jira | le ticket |
| `stale` | ticket **en cours** sans activité Jira depuis 5 jours ou plus | Jira (`updated`) | le ticket |
| `proposal` | décisions de réunion à consigner | Mémoire (`docs/ipc/team-memory.md`) | écran Mémoire |
| `transition` | passages à « terminé » proposés (pull requests fusionnées) | liens de tickets (`docs/ipc/ticket-links.md`) | écran Journal |
| `design-ready` | maquette Figma marquée prête pour le développement | liens de tickets | la maquette |

## Par rôle (`DIGEST_KINDS_BY_ROLE`, `src/shared/digest.ts`)

Un type absent de la liste n'est pas montré à ce rôle ; 2 points au plus par type, dans cet ordre.

| Rôle | Types, dans l'ordre |
|---|---|
| PO / PM, Management | `blocker`, `stale`, `proposal`, `transition` |
| Développement | `transition`, `blocked`, `design-ready`, `blocker`, `stale` |
| Design | `design-ready`, `proposal`, `blocker` |
| Architecture | `proposal`, `blocker`, `stale` |
| QA | `transition`, `blocker`, `stale` |
| Sans rôle | `blocker`, `proposal`, `transition`, `stale` |

## Alertes de blocage

Un `blocker`, `blocked` ou `stale` jamais signalé donne lieu à une notification BYKO (`docs/ipc/notifications.md`, cible
« day »), affichée seulement si l'app n'est pas au premier plan. Les points déjà signalés sont retenus par compte dans le
`localStorage` du renderer. Le digest est relu toutes les 10 minutes **tant que la vue journée est affichée** : pas de
relève depuis le Journal, la Mémoire ou un point d'équipe, ni application fermée.

## Limites connues

- Jira : les 50 tickets ouverts les plus récemment mis à jour des projets connectés, **sans filtre sur l'assignation**
  (même choix que `searchOpenIssues`) : le digest parle du projet, pas seulement de « mes » tickets.
- Un lien de blocage est reconnu par son type « Blocks » (nom standard) ou un libellé entrant contenant « block » / « bloqu ».
- « Bloqué depuis X jours » n'est pas mesurable (Jira ne date pas les liens) : `stale` mesure l'absence d'activité.
- Une source en échec vaut « rien à signaler de ce côté » pour cet appel (nom et code de l'erreur tracés, jamais le contenu).
- Pas d'alerte Slack/Teams : ces connecteurs n'existent pas.

## Fichiers

`src/shared/digest.ts` · `src/main/digest.ts` (`buildDigest`, pur) · `jira.searchAttentionIssues` ·
`src/renderer/src/lib/useDigest.ts` · `DayView.tsx`.
