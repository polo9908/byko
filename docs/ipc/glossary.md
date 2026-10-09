# Contrat IPC — Vocabulaire des réunions

Une base de vocabulaire livrée avec BYKO (Agile, Scrum, IT, développement, architecture, design, abréviations comprises, en
français et en anglais) + la liste de l'utilisateur, éditable dans Réglages > Vocabulaire.

## Ce que ça fait — et ne fait pas

| Étape | Effet |
|---|---|
| Transcription (`speech:transcribe`) | Le texte renvoyé est **corrigé** : les erreurs de transcription connues sont remplacées (« dev ops » → « DevOps », « c i c d » → « CI/CD », « git hub » → « GitHub »). Une seule passe, jamais de double remplacement. |
| Résumé et extraction (`meeting:summarize`, `meeting:extractItems`) | Le prompt reçoit un bloc « Vocabulaire de l'équipe » : la **signification des seuls termes présents** dans la transcription (40 au plus, les termes de l'utilisateur en premier). Aucun terme absent n'est envoyé. Rien n'est ajouté si aucun terme n'apparaît. |
| Reconnaissance vocale (Whisper local) | **Non modifiée.** Elle n'est pas « biaisée » vers le vocabulaire : seul ce qu'elle a déjà écrit est corrigé. |

Le vocabulaire est envoyé au fournisseur d'IA de l'utilisateur comme le reste du prompt, et n'est pas utilisé si l'IA est désactivée (`docs/ipc/ai-enabled.md`).

## Fichiers

- `src/shared/glossaryBuiltin.ts` : la base (donnée pure : `term`, `meaning`, `aliases?`, `fixCase?`). L'enrichir = ajouter une ligne.
  Règles : un alias est une **faute de transcription probable**, jamais une traduction, une forme développée ni un mot courant.
  `fixCase` jamais pour un mot courant (« art », « ci », « po »).
- `src/main/glossaryEngine.ts` : moteur pur (`buildLexicon`, `correctTranscript`, `glossaryPromptBlock`).
- `src/main/glossary.ts` : stockage par compte (`glossary.json`, écriture atomique, accès sérialisés) et validation.

## Règles de correction

- Casse ignorée pour les alias ; espaces et tirets équivalents (« stand-up » = « stand up »).
- Frontières de mot Unicode : « art » dans « article » n'est jamais touché.
- Sigles de 3 à 6 lettres : leurs formes épelées (« A P I », « A.P.I ») sont corrigées automatiquement.
- Sigles de 3 caractères ou moins (PO, SM, AC…) : reconnus **en majuscules uniquement** pour le bloc IA.
- Un terme de l'utilisateur remplace celui de la base portant le même nom (casse ignorée).
- Casse imposée pour un terme utilisateur seulement s'il a ≥ 3 caractères et une majuscule après la première lettre.

## Canaux (renderer → main)

| Canal | `window.api.glossary.*` | Entrée | Sortie |
|---|---|---|---|
| `glossary:get` | `get()` | — | `GlossaryState` : `{ builtinEnabled, builtinCount, entries }` |
| `glossary:setBuiltinEnabled` | `setBuiltinEnabled(enabled)` | booléen strict | `GlossaryState` |
| `glossary:add` | `add({ term, meaning?, aliases?, squad? })` | terme 1–60 car., signification ≤ 240, ≤ 8 variantes de ≤ 60, équipe ≤ 40 | `GlossaryState` (un terme existant — casse ignorée — est mis à jour) |
| `glossary:remove` | `remove(id)` | chaîne ≤ 64 car. | `GlossaryState` |
| `glossary:import` | `import(text)` | texte ≤ 100 000 car. | `{ state, result: { added, skipped } }` |

- Validation dans main (`assertDraft`, `assertEntryId`, `assertImportText`) : rien ne vient du renderer sans contrôle ; 500 termes au plus.
- Import : une ligne par terme, `terme = signification` ou `terme ; signification ; variante | variante` (séparateurs `;`, tabulation, `=`, `:`). Lignes vides et `#` ignorées. `skipped` ne contient jamais le contenu des lignes.
- Stockage : `userData/accounts/<id>/glossary.json`, **propre à chaque compte** (voir `docs/ipc/accounts.md`). En clair : ce sont des préférences de contenu, pas des secrets (même précédent que `journal.json`). Fichier illisible → reprise avec le vocabulaire de base, sans erreur.
- `squad` (facultatif) : l'équipe à laquelle un terme est propre ; absent, le terme est commun à tous. Affiché dans Réglages > Vocabulaire et cherchable dans la Mémoire d'équipe (`docs/ipc/team-memory.md`) ; sans effet sur la correction ni sur le bloc IA. L'import ne le renseigne pas et conserve celui d'un terme existant.
- Aucune dépendance au réseau ; aucune donnée ne quitte l'appareil sauf le bloc de contexte décrit plus haut.

## Limites connues

- La langue de transcription est fixée à `french` (`speech.ts`) : une réunion entièrement en anglais est transcrite avec un biais français. Le vocabulaire n'y change rien.
- Pas d'export du vocabulaire (l'import couvre l'entrée ; un export est un ajout simple).
- Les alias de la base sont écrits à la main : une faute de transcription non prévue n'est pas corrigée tant qu'elle n'est pas ajoutée (par l'utilisateur dans « Variantes mal transcrites », ou à la base).
