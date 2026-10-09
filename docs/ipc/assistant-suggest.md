# Contrat IPC — Suggestions en direct de « Parler à BCC » + persistance des décisions de réunion

> Contrat figé par l'orchestrateur le 30/09/2026. `main-process-engineer` implémente la partie
> main/preload/shared, `renderer-engineer` la consomme. Toute modification passe par
> l'orchestrateur.

## Pourquoi

Dans le champ texte de « Parler à BCC » (`TalkToBcc.tsx`, phase `typing`), dès 2 caractères
tapés, une liste déroulante propose des suggestions filtrées en direct, issues de trois
sources **locales** : tickets Jira ouverts, activité d'hier (journal), décisions/tâches de
point d'équipe. Aucun appel LLM : filtrage par sous-chaîne côté main. `assistant:ask` (LLM,
lent) reste inchangé et n'est appelé qu'à la validation d'une suggestion.

## Types partagés (`src/shared/assistant.ts`, ajoutés à l'existant)

```ts
export type AssistantSuggestionKind = "ticket" | "journal" | "decision"

export interface AssistantSuggestion {
  /** Unique dans la réponse, stable pour une même source (clé React). Ex. "ticket:SCRUM-3", "journal:<uuid>", "decision:<uuid>". */
  id: string
  kind: AssistantSuggestionKind
  /** Texte principal affiché (résumé du ticket, titre de l'entrée journal, texte de la décision). */
  label: string
  /** Complément court optionnel : clé + statut du ticket, « Hier 14:05 », « Décision · 29/09 », etc. Construit par main. */
  detail?: string
  /** Question complète soumise à `assistant.ask` quand l'utilisateur valide la suggestion. Construite par main (gabarit déterministe, pas d'IA). */
  question: string
}

export const ASSISTANT_SUGGEST_MIN_CHARS = 2
export const ASSISTANT_SUGGEST_MAX_CHARS = 200
export const ASSISTANT_SUGGEST_MAX_RESULTS = 6
```

## Types partagés (`src/shared/meeting.ts`, ajoutés à l'existant)

```ts
/** Décision ou tâche de point d'équipe persistée (userData/meeting-decisions.json). */
export interface MeetingDecisionRecord {
  id: string          // randomUUID
  /** Compte rendu d'origine (UUID minuscule) — voir « Révision 2 ». Absent des enregistrements antérieurs. */
  reportId?: string
  type: MeetingItemType
  text: string
  /** ISO 8601 — moment de l'envoi du compte rendu. */
  createdAt: string
}
```

## Canaux

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `assistant:suggest` (**nouveau**) | `assistant.suggest(query)` | `string` | `AssistantSuggestion[]` (≤ 6) |
| `meeting:sendReport` (**signature modifiée**) | `meeting.sendReport(reportId, items)` | UUID `string`, `MeetingItemDraft[]` | `void` — voir « Révision 2 » |

### `assistant:suggest` — sémantique

1. Validation main : `query` doit être une `string` (sinon rejet). `trim()`. Longueur après
   trim `< 2` → renvoie `[]` sans rien lire. Longueur `> 200` → rejet.
2. Sources, lues à chaque appel (sauf Jira, en cache) :
   - **Tickets** : `jira.searchOpenIssues()` via un **cache mémoire de 30 s** propre à ce canal
     (les appels concurrents partagent la même promesse en vol). Échec Jira (non connecté,
     réseau) → la source ticket est vide pour cette fenêtre de 30 s, `console.warn` une fois
     par échec ; les deux autres sources continuent de répondre. Pas de donnée de repli
     inventée. `assistant:ask` n'utilise **pas** ce cache.
   - **Journal d'hier** : nouvelle fonction `journal.listYesterday()` (jour calendaire local
     précédent, même logique que `listToday()`).
   - **Décisions de réunion** : `meetingDecisions.listRecent()` (nouveau module
     `src/main/meetingDecisions.ts`), les plus récentes d'abord.
3. Matching : normalisation `toLowerCase()` + suppression des diacritiques
   (`normalize("NFD")` puis retrait de `\p{Diacritic}`). La requête est découpée en mots ;
   **chaque** mot doit apparaître en sous-chaîne dans le texte cherché (ticket : clé +
   résumé ; journal : titre ; décision : texte). Score : texte commençant par la requête >
   un mot commençant par le premier terme > simple sous-chaîne. Tri par score puis ordre
   des sources (ticket, décision, journal), tronqué à 6.
4. `question` construite par main, par exemple :
   - ticket : `Où en est le ticket ${key} « ${summary} » ?`
   - journal : `Qu'as-tu fait hier concernant « ${title} » ?`
   - décision/tâche : `Où en est la ${décision|tâche} du point d'équipe « ${text} » ?`
5. Aucune valeur saisie par l'utilisateur n'est loggée.

### `meeting:sendReport(reportId, items)` — sémantique

1. Validation main : `items` doit être un tableau (sinon rejet), ≤ 200 éléments ; chaque
   élément `{ type: "decision" | "task", text: string }`, `text` trimé non vide, ≤ 500
   caractères. Élément invalide → rejet de l'appel entier (message FR), rien n'est écrit.
2. Persiste chaque item comme `MeetingDecisionRecord` (même `createdAt` pour tout le lot)
   dans `userData/meeting-decisions.json` — JSON en clair, même précédent que
   `journal.json` (données métier, pas des secrets au sens de `secrets.ts`). Chemin via
   `path.join(app.getPath("userData"), ...)`. Rétention : on garde au plus les 500
   enregistrements les plus récents.
3. Puis ajoute l'entrée journal existante (« Compte rendu du point d'équipe envoyé à
   l'équipe »), inchangée.
4. Tableau vide accepté (réunion sans décision) : rien n'est ajouté côté décisions (et les
   enregistrements d'un `reportId` déjà présent sont retirés, cf. révision 3), l'entrée
   journal est quand même ajoutée.

Point d'accroche choisi : l'envoi du compte rendu, pas l'extraction en direct. Pendant la
réunion l'IA peut encore retirer des items (`removals`) et l'utilisateur peut les annuler ou
les corriger après l'arrêt ; l'envoi est le seul moment où la liste est validée par
l'utilisateur. Conséquence assumée : une réunion dont le compte rendu n'est jamais envoyé
n'alimente pas les suggestions.

## Robustesse (révision du 30/09/2026, suite à docs/qa-reports/2026-09-30-assistant-suggest.md)

- Constantes partagées dans `src/shared/meeting.ts` : `MEETING_REPORT_MAX_ITEMS = 200`,
  `MEETING_ITEM_MAX_CHARS = 500` — utilisées par la validation main ET par le renderer.
- `meeting:extractItems` tronque le texte des `additions` à `MEETING_ITEM_MAX_CHARS` (l'IA n'a
  pas de borne) ; le champ d'édition d'un item a `maxLength={MEETING_ITEM_MAX_CHARS}`. Ainsi
  un compte rendu produit par l'app respecte toujours la validation de `sendReport`.
- Écriture de `meeting-decisions.json` atomique (fichier temporaire dans le même dossier puis
  `rename`).
- Lecture validée : fichier non-JSON ou dont la racine n'est pas un tableau → le fichier est
  **mis de côté** (renommé `meeting-decisions.corrupt-<horodatage>.json`, jamais supprimé),
  `console.warn` sans aucun extrait du contenu, et on repart de `[]`. Les enregistrements
  individuellement invalides (champs manquants, `type` inconnu, `createdAt` non parsable) sont
  ignorés. Aucun message d'erreur (log ou rejet IPC) ne contient d'extrait du fichier.
- `assistant:suggest` combine les sources avec `Promise.allSettled` : une source en échec est
  vide (avertissement sans contenu), les autres répondent.
- Le cache tickets de `assistant:suggest` est vidé à la déconnexion/reconnexion Jira.
- Renderer : un échec de `sendReport` ne perd pas la réunion — les items restent affichés et
  l'envoi peut être relancé (« Réessayer »).

### Révision 2 (30/09/2026, contre-audit) — idempotence et borne du nombre d'items

- **Signature** : `meeting:sendReport(reportId, items)` / `window.api.meeting.sendReport(reportId: string, items: MeetingItemDraft[])`.
  `reportId` : UUID généré par le renderer **une fois par réunion** (au démarrage de
  l'enregistrement), réutilisé à l'identique pour chaque « Réessayer ». Validation main :
  string au format UUID (regex stricte, sinon rejet).
- `MeetingDecisionRecord` gagne `reportId: string`. Les enregistrements existants sans
  `reportId` restent valides (champ optionnel à la lecture).
- Sémantique (révision 3, contre-audit n°2) : si des enregistrements portant ce `reportId`
  existent déjà, ils sont **remplacés** par le lot reçu (le dernier envoi fait foi : une
  correction faite entre un échec partiel et « Réessayer » est prise en compte), sans
  doublon ; l'entrée journal est ensuite tentée normalement. Lecture, remplacement et écriture
  dans la même section sérialisée. Un lot vide pour un `reportId` existant retire ses
  enregistrements.
- Renderer : « Retour » est désactivé pendant l'envoi.
- Renderer : le bouton d'envoi est désactivé pendant l'appel (pas de double envoi).
- Borne du nombre d'items à la source : quand la réunion atteint `MEETING_REPORT_MAX_ITEMS`,
  le renderer n'ajoute plus d'items extraits et affiche une mention visible (« Limite de 200
  décisions et tâches atteinte ») ; l'app ne produit donc jamais un lot que `sendReport`
  rejetterait sur le nombre. Seule la troncature de longueur est faite côté main.

## Côté renderer

- `PointDEquipeView.handleSendReport` passe `items.map(({ type, text }) => ({ type, text }))`
  (état courant, après corrections/annulations).
- `TalkToBcc.tsx` : debounce 200 ms ; appel uniquement si `trim().length >= 2` ; les réponses
  périmées (requête plus ancienne que la saisie courante) sont ignorées. En cas d'erreur, la
  liste est masquée, rien n'est inventé.
