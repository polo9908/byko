# Contrat IPC — Identifiants OAuth Google fournis par l'utilisateur (E4bis)

> Contrat figé par l'orchestrateur le 26/09/2026. `main-process-engineer` l'implémente,
> `renderer-engineer` le consomme. Toute modification passe par l'orchestrateur.

## Pourquoi

BYKO est open source : aucun Client ID/Secret Google partagé n'est embarqué. Chaque
utilisateur crée son propre client OAuth « Application de bureau » (≈2 min, une seule fois)
et le colle dans l'app. Les identifiants sont lus **au runtime** depuis `main/secrets.ts`
(`safeStorage`), jamais au build.

Le repli `.env` (`MAIN_VITE_GOOGLE_CLIENT_ID/SECRET`) n'existe **qu'en mode dev**
(`import.meta.env.DEV`) : un `npm run build` ne doit plus embarquer le secret dans
`out/main/index.js` (constat au 26/09 : il y était, en clair).

## Types partagés (`src/shared/googleCalendar.ts`, ajoutés à l'existant)

```ts
export type GoogleCalendarCredentialsSource = "user" | "dev-env"

export interface GoogleCalendarCredentialsStatus {
  configured: boolean
  /** null si configured === false. Jamais de Client Secret, même masqué. */
  source: GoogleCalendarCredentialsSource | null
}

/** Pages Google Cloud Console ouvrables depuis l'assistant. Les URL vivent côté main uniquement. */
export type GoogleCalendarSetupPage =
  | "createProject"
  | "enableApi"
  | "consentScreen"
  | "testUsers"
  | "createClient"

export const GOOGLE_CALENDAR_SETUP_PAGES: readonly GoogleCalendarSetupPage[]
```

## Canaux (tous `ipcRenderer.invoke` / `ipcMain.handle`, exposés via `window.api.calendar`)

| Canal | `window.api.calendar.*` | Entrée | Sortie |
|---|---|---|---|
| `calendar:connect` | `connect()` | — | `GoogleCalendarConnectionStatus` — **inchangé**, utilise les identifiants stockés (ou `.env` en dev). Sans identifiants : rejet `"Identifiants Google non configurés."` |
| `calendar:getStatus` | `getStatus()` | — | inchangé |
| `calendar:disconnect` | `disconnect()` | — | inchangé (révoque les jetons, **conserve** les identifiants client) |
| `calendar:listTodayEvents` | `listTodayEvents()` | — | inchangé |
| `calendar:getCredentialsStatus` | `getCredentialsStatus()` | — | `GoogleCalendarCredentialsStatus` |
| `calendar:openSetupPage` | `openSetupPage(page)` | `GoogleCalendarSetupPage` | `void`. Main valide contre la liste blanche ; l'URL n'est **jamais** fournie par le renderer. |
| `calendar:connectWithCredentials` | `connectWithCredentials(clientId, clientSecret)` | 2 × `string` | `GoogleCalendarConnectionStatus` |
| `calendar:cancelConnect` | `cancelConnect()` | — | `void`. Annule l'attente d'autorisation en cours (`connect` ou `connectWithCredentials`) ; no-op si rien en cours. |

### `connectWithCredentials` — sémantique exacte (« Tester la connexion »)

1. `trim()` des deux valeurs. Validation côté main :
   - Client ID : doit se terminer par `.apps.googleusercontent.com` (caractères `[A-Za-z0-9-]` avant).
   - Client Secret : non vide, sans espace interne, longueur ≤ 256.
   - Échec → rejet immédiat, message FR explicite, **navigateur non ouvert**.
2. **Pré-vérification** sans navigateur : POST sur le token endpoint avec ces identifiants et
   un code factice. `invalid_client` → rejet immédiat avec message FR distinguant si possible
   « Client ID introuvable » et « Client Secret incorrect ». `invalid_grant` = identifiants
   valides, on continue. Erreur réseau → rejet explicite (jamais avalée).
3. Flux OAuth boucle locale + PKCE **existant**, strictement identique, avec ces identifiants.
4. Succès seulement : persistance des identifiants (clé `google.calendar.client`, via
   `setSecret`) **et** des jetons (clé existante). Échec à n'importe quelle étape : rien
   n'est écrit, identifiants et jetons antérieurs intacts.
5. Une seule connexion en attente à la fois : un 2ᵉ appel pendant une attente → rejet
   `"Une connexion Google est déjà en cours."`.

Priorité de résolution des identifiants (pour `connect`, refresh) : `user` > `dev-env` (dev
uniquement) > aucun.

## Messages d'erreur (FR, affichés tels quels par le renderer après `cleanIpcErrorMessage`)

Ils ne contiennent **jamais** le secret, un jeton, le code d'autorisation, le `code_verifier`
ni le corps brut de la requête. Cas minimum : format Client ID, format Secret, client
introuvable, secret incorrect, `access_denied` (rappeler l'ajout de son adresse en
utilisateur test), délai dépassé (existant), annulation (`"Connexion Google annulée."`),
réseau.

## Règles de confidentialité

- Le Client Secret ne repart **jamais** vers le renderer, sous aucune forme.
- Aucun `console.*` contenant identifiants, jetons, codes.
- Aucun getter générique de secret exposé.
