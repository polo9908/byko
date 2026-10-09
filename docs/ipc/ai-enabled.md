# Contrat IPC — Interrupteur général « Utiliser l'IA »

Complète `docs/ipc/assistant-context-privacy.md` (même fichier `userData/privacy.json`).

## Types partagés (`src/shared/privacy.ts`)

`PrivacySettings` gagne `aiEnabled: boolean` (défaut `true`).

## Canal

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `privacy:setAiEnabled` | `privacy.setAiEnabled(enabled)` | `boolean` strict | `PrivacySettings` (état relu après écriture) |

Rejet si `typeof enabled !== "boolean"` (rien n'est écrit) ou si l'écriture échoue (message FR, code `errno` seul).

## Application

- Tous les appels au fournisseur passent par `completeWithAi` (`src/main/index.ts`) : `meeting:summarize`,
  `meeting:extractItems`, `assistant:ask` et l'agent de pilotage navigateur. La vérification d'une clé (`verifyKey`, à la connexion) n'est pas concernée.
  Le réglage est relu à chaque appel ; désactivé → rejet « L'IA est désactivée dans les Réglages. », rien n'est envoyé.
- Lecture fail-closed : fichier illisible / JSON invalide / `aiEnabled` non booléen → IA **désactivée**.
  `aiEnabled` absent (fichier écrit avant ce contrat) → défaut `true`.
- Les écritures `setShareRecentActivity` et `setAiEnabled` préservent l'autre champ.

## Préférences d'accessibilité

Hors IPC : `localStorage` du renderer (`lib/accessibility.ts`), purement visuelles, aucun secret.
