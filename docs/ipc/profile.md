# Contrat IPC — Profil local (connexion auto)

Pour ne rien ressaisir aux lancements suivants : l'e-mail de la première configuration et la fin de l'assistant de démarrage
sont mémorisés. Les jetons (Jira, IA, Figma, Google Agenda) l'étaient déjà, chiffrés par `safeStorage` (`src/main/secrets.ts`).

| Canal | `window.api.*` | Entrée | Sortie |
|---|---|---|---|
| `profile:get` | `profile.get()` | — | `{ email?, onboarded }` |
| `profile:saveEmail` | `profile.saveEmail(email)` | chaîne contenant `@`, ≤ 254 car. | `void` |
| `profile:saveRole` | `profile.saveRole(role)` | identifiant de la liste blanche `PROFILE_ROLES` (`product`, `dev`, `design`, `architect`, `qa`, `manager`) | `void` ; rejette si le stockage chiffré est indisponible |
| `profile:completeOnboarding` | `profile.completeOnboarding()` | — | `void` |

- Stockage : clés `profile.email` et `profile.onboarded` de `secrets.json` (chiffré). Jamais de clair sur le disque.
- Rôle : clé `profile.role`, propre à chaque compte. Choisi à la première étape de l'assistant (obligatoire pour continuer), modifiable dans Réglages > Comptes > « Mon rôle ». Une valeur hors liste relue du disque est ignorée ; un compte configuré avant ce choix n'a pas de rôle. Le rôle choisit et ordonne les points du digest de la vue journée (`docs/ipc/digest.md`) ; il n'adapte aucun autre écran.
- Chiffrement indisponible ou lecture impossible : `get` renvoie `{ onboarded: false }` (comme un premier lancement), les écritures
  sont ignorées ; l'app reste utilisable, elle redemandera simplement la configuration.
- Renderer : `App` lit le profil au démarrage ; `onboarded` → vue journée directement, sinon accueil avec l'e-mail pré-rempli.
  L'étape Jira reprend une connexion existante (`jira.getStatus`) sans redemander domaine ni jeton.
- `onboarded` passe à vrai au clic sur « Commencer ma journée ».

## Installation déjà configurée (migration)

Si `profile.onboarded` est absent mais que **Jira et un fournisseur d'IA sont déjà connectés** (jetons chiffrés), `profile:get`
considère l'installation comme configurée : il renvoie `onboarded: true`, reprend l'e-mail de la connexion Jira, et complète
le profil. Aucun e-mail n'est jamais écrit en dur dans le code.
