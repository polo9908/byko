# Contrat — Vocabulaire personnel appris localement, complétion fantôme et fusion voix/texte

> Contrat figé le 30/09/2026. Il complète `docs/ipc/assistant-suggest.md` (non remplacé) : les
> raccourcis appris s'ajoutent aux sources de `assistant:suggest` et alimentent la complétion
> fantôme du champ. **Aucun apprentissage n'est transmis au fournisseur IA.**

## Pourquoi

Trois manques après la livraison des suggestions en direct :

1. **Vocabulaire personnel (local).** L'utilisateur retape souvent la même formulation pour une
   cible précise (« mes trucs » pour un ticket donné). On mémorise l'association « phrase tapée →
   suggestion choisie » sur sa machine, pour la remonter en tête la prochaine fois.
2. **Complétion fantôme.** Terminer la phrase pendant la frappe (façon Copilot), en local.
3. **Fusion voix/texte.** Le champ et la voix vivaient côte à côte mais le passage de l'un à
   l'autre remplaçait le texte. Ils se concaténent désormais en une seule question.

## Types partagés (`src/shared/vocabulary.ts`, nouveau)

```ts
export interface PersonalShortcut {
  phrase: string          // forme normalisée (minuscules, sans diacritiques) — clé d'unicité
  typed: string           // dernière forme réellement tapée (affichage + complétion)
  question: string        // question complète à soumettre à assistant.ask
  kind: AssistantSuggestionKind
  targetId: string        // clé Jira, uuid journal/décision
  label: string
  detail?: string
  count: number           // confirmations (une sélection = une confirmation)
  updatedAt: string       // ISO 8601
}

export interface ShortcutDraft { kind; targetId; label; question; detail? }

export const VOCABULARY_MIN_CHARS = 2
export const VOCABULARY_MAX_CHARS = 200
export const VOCABULARY_LABEL_MAX_CHARS = 300
export const VOCABULARY_QUESTION_MAX_CHARS = 500
export const VOCABULARY_DETAIL_MAX_CHARS = 200
export const VOCABULARY_MAX_SHORTCUTS = 200
```

`src/shared/assistant.ts` : `AssistantSuggestion` gagne `learned?: boolean`.

## Canaux

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `vocabulary:list` (nouveau) | `vocabulary.list()` | — | `PersonalShortcut[]` (les plus confirmés d'abord) |
| `vocabulary:record` (nouveau) | `vocabulary.record(query, draft)` | `string`, `ShortcutDraft` | `PersonalShortcut` (raccourci mis à jour) |
| `vocabulary:forget` (nouveau) | `vocabulary.forget()` | — | `void` |

### `vocabulary:record(query, draft)` — sémantique

1. Validation main : `query` chaîne, `trim()` entre 2 et 200 caractères ; `draft` objet avec
   `kind` ∈ {ticket, journal, decision}, `targetId` non vide ≤ 200, `label` non vide ≤ 300,
   `question` non vide ≤ 500, `detail` optionnel ≤ 200. Tout écart → rejet (message FR), rien
   n'est écrit.
2. `phrase = normalizeForMatch(query.trim())` (minuscules, sans diacritiques, espaces réduits).
   La même `phrase` **met à jour** son raccourci (dernière forme tapée, cible, question,
   `count += 1`, `updatedAt`) au lieu d'en créer un second.
3. Plafond `VOCABULARY_MAX_SHORTCUTS` : au-delà, les moins confirmés puis les plus anciens sont
   oubliés.
4. Aucun log ne cite `query`, `label` ni `question`.

### `vocabulary:forget()`

Écrit un tableau vide (`userData/personal-vocabulary.json` → `[]`). Idempotent.

## Persistance (`src/main/vocabulary.ts`, nouveau)

- `userData/personal-vocabulary.json` en clair (données privées de l'utilisateur, pas un secret
  au sens de `secrets.ts`), même précédent que `journal.json`.
- Écriture atomique (`.tmp` du même dossier puis `rename`), lectures/écritures **sérialisées**
  (une file unique) : deux confirmations rapprochées ne se perdent pas.
- Lecture : fichier absent (`ENOENT`) → `[]` ; JSON invalide ou racine non-tableau → fichier
  **mis de côté** (`personal-vocabulary.corrupt-<horodatage>.json`, jamais supprimé), `console.warn`
  sans contenu, reprise à `[]`. Un raccourci invalide est ignoré individuellement. Les erreurs
  recopient le code `errno` sur `.code` ; aucun message ne cite le contenu du fichier.

## Effet sur `assistant:suggest`

- Les raccourcis appris qui correspondent à la requête (la requête préfixe la `phrase` mémorisée,
  ou l'inverse) sont renvoyés **en tête**, marqués `learned: true`, `id = personal:<kind>:<targetId>`,
  dédupliqués par cible réelle avec les suggestions de source, plafond global `ASSISTANT_SUGGEST_MAX_RESULTS`.
- **Réglage de partage désactivé** (ou illisible) : seuls les raccourcis `kind: "ticket"` remontent,
  pour ne pas contredire `docs/ipc/assistant-context-privacy.md`.
- Une lecture du vocabulaire en échec vaut source vide pour cet appel (avertissement nom+code).

## Complétion fantôme (`src/renderer/src/lib/completion.ts`, nouveau)

- `completeTyped(typed, corpus)` — pure : renvoie le reste de la phrase **la plus courte** du
  corpus qui commence par ce qui est tapé (comparaison insensible à la casse), ou `null`.
  Seuil `GHOST_MIN_CHARS = 3`.
- Corpus **local** : formes tapées et questions des raccourcis appris, puis questions types.
  Aucun appel réseau ni IA.
- Affichage : miroir grisé au-dessus du champ (partie déjà tapée transparente, seul le reste est
  visible). Proposé uniquement si le champ est focalisé, le curseur **en fin de saisie**, la liste
  de suggestions fermée, et ≥ 3 caractères. `Tab` accepte la complétion (le reste du temps, `Tab`
  garde son rôle).
- Limite assumée : pas de complétion au milieu d'un texte déjà saisi.

## Fusion voix/texte (`TalkToBcc.tsx`)

- Le texte déjà tapé **n'est plus remplacé** par la dictée : il est conservé et la transcription
  s'y **ajoute** (`« <texte> <dictée> »`).
- Depuis la saisie, un bouton micro « Dicter la suite » ouvre l'écoute sans effacer le texte.
- À la fin de l'écoute : **Envoyer / Espace** envoie la question combinée ; **« Écrire la suite »**
  replace le texte combiné dans le champ pour le relire ou le continuer.
- Voix seule (champ vide) : allait et reste un envoi direct, en un geste.
- Silence : le texte écrit est conservé, jamais perdu.

## Réglages (`SettingsModal`)

- Section « Raccourcis personnels » : compte des raccourcis appris et bouton **« Oublier »**
  (`vocabulary:forget`). Texte explicite : l'apprentissage reste sur l'appareil et n'est jamais
  envoyé à l'IA. Pas d'état optimiste : le compte vient de `vocabulary:list`.
