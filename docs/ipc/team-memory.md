# Contrat IPC — Mémoire d'équipe

Écran « Mémoire » (bouton de la vue journée) : les décisions consignées avec leur pourquoi, celles que les réunions font
émerger, le parcours d'arrivée, « qui sait quoi » et une recherche unique sur tout ce que BYKO connaît.

## Ce que ça fait — et ne fait pas

| Besoin | Réponse |
|---|---|
| Journal de décisions (ADR) | Une décision = sujet, ce qui a été décidé, pourquoi (facultatif), qui contacter, date. |
| Proposition après réunion | Chaque **décision** d'un compte rendu envoyé (`meeting:sendReport`) apparaît dans « Décidé en réunion, à consigner » ; « Consigner » préremplit le formulaire, « Ignorer » l'écarte pour de bon. La pastille du bouton « Mémoire » en donne le nombre. |
| Parcours d'arrivée | Les décisions marquées « clés » (10 au plus), dans l'ordre chronologique. |
| Qui sait quoi | **Déduit** des personnes citées sur les décisions : aucune fiche à tenir à jour. |
| Recherche unifiée | Locale, sans IA, pendant la frappe : décisions consignées, décisions et tâches de réunion, vocabulaire (le sien, puis la base si elle est activée), tickets Jira ouverts, pull requests et maquettes Figma reliées aux tickets suivis. Les comptes rendus de réunion (stockés dans le renderer) sont cherchés côté renderer. |
| Question en langage naturel | « Demander à BCC » : réponse de l'IA à partir des décisions consignées. |

- La recherche est **lexicale** (tous les mots, accents et casse ignorés), pas vectorielle : c'est « Demander à BCC » qui couvre
  la reformulation. Aucun index, aucun modèle d'embedding.
- Aucun connecteur de documents (Confluence, Drive…) n'existe : les « docs » ne sont pas cherchés.
- La mémoire est **propre à chaque compte, sur cet appareil** : elle n'est pas partagée entre collègues.
- Les deux indicateurs de succès (temps pour retrouver une décision, durée d'onboarding) ne sont pas mesurés.

## Canaux (renderer → main)

| Canal | `window.api.memory.*` | Entrée | Sortie |
|---|---|---|---|
| `memory:get` | `get()` | — | `MemoryState` : `{ decisions, proposals }` |
| `memory:save` | `save(draft)` | `DecisionDraft` (avec `id` : modification) | `MemoryState` |
| `memory:remove` | `remove(id)` | chaîne 1–64 car. | `MemoryState` |
| `memory:dismissProposal` | `dismissProposal(id)` | chaîne 1–64 car. | `MemoryState` |
| `memory:search` | `search(query)` | chaîne ≤ 200 car. (moins de 2 : `[]`) | `MemoryHit[]`, 5 au plus par source |
| `memory:ask` | `ask(question)` | chaîne 2–200 car. | texte de la réponse |

- Validation dans main (`memory.assertDraft`, `assertId`, `assertQuery`) : sujet 1–140 car., décision 1–600, pourquoi ≤ 1 500,
  8 personnes de 60 car. au plus, date `AAAA-MM-JJ`, `key` booléen strict. Tout champ inconnu est ignoré. 300 décisions au plus.
- Le renderer n'envoie ni chemin ni URL. Les `url` des résultats viennent des intégrations (Jira, forge, Figma) et ne sont
  renvoyées que si elles sont en `https://`.
- Supprimer une décision issue d'une réunion écarte aussi sa source : elle n'est pas reproposée.

## IA et confidentialité

- `memory:search` n'appelle jamais l'IA.
- `memory:ask` passe par `completeWithAi` (interrupteur « Utiliser l'IA », `docs/ipc/ai-enabled.md`). Les décisions
  **consignées** sont envoyées au fournisseur de l'utilisateur, à sa demande explicite (bouton, jamais la touche Entrée) :
  les plus proches de la question d'abord, dans la limite de 24 000 caractères. Les décisions **de réunion** ne sont jointes
  que si « partager l'activité récente » est activé (lecture fail-closed, `docs/ipc/assistant-context-privacy.md`).
- Le prompt présente ces blocs comme des données, pas des instructions.

## Stockage

`userData/accounts/<id>/memory.json` : `{ decisions, dismissed }`, en clair (donnée métier, même précédent que
`journal.json`), écriture atomique, accès sérialisés. Un fichier au JSON invalide provoque une **erreur affichée**, jamais une
reprise à vide : la prochaine écriture effacerait des décisions saisies à la main. Aucun log ne cite le contenu.

## Fichiers

`src/shared/memory.ts` (types et bornes) · `src/main/memory.ts` (stockage, validation, `searchMemory`, `buildMemoryPrompt`) ·
`src/renderer/src/screens/memory/` (écran, sur les cartes du Journal).
