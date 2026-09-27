# BYKO — contrat du projet

Application desktop Electron + React + TypeScript (electron-vite). État daté du projet :
`handoff.md`. Backlog : `docs/backlog/bcc-implementation.md`. Contrats IPC : `docs/ipc/`.
Rapports QA : `docs/qa-reports/`.

## Frontière de sécurité (non négociable)

- `BrowserWindow` : `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
  Preload en CommonJS (`.cjs`) à cause du sandbox — voir `electron.vite.config.ts`.
- Le renderer ne voit que `window.api` (contextBridge). Jamais `ipcRenderer` brut, jamais
  `require`, jamais `window.electron`/`electronAPI` de `@electron-toolkit/preload`.
- Chaque `ipcMain.handle` valide ses paramètres (`unknown` → assert). Une URL, un chemin ou
  une commande ne viennent jamais du renderer : le renderer envoie un identifiant de liste
  blanche, main résout.
- Renderer : aucun import de `fs`, `child_process`, `path`, module natif.

## Secrets

- Stockage unique : `src/main/secrets.ts` (`safeStorage`). Jamais de secret en clair sur
  disque, dans un log, ou renvoyé au renderer après sauvegarde (au mieux un statut / une
  valeur masquée).
- **Aucun secret embarqué au build.** Les variables `MAIN_VITE_*` de `.env` ne servent que
  de repli en mode dev (`import.meta.env.DEV`) ; après `npm run build`, le secret de `.env`
  doit être absent de `out/`.
- Google Agenda : chaque utilisateur fournit son propre client OAuth « Application de
  bureau » via l'assistant intégré (contrat : `docs/ipc/google-calendar-credentials.md`).
  Remplace la décision antérieure « un seul client OAuth pour toute l'app ».

## Vérification

- `npm run typecheck`, `npm run lint` (0 avertissement), `npm run build`.
- Tout comportement sensible se valide sur le **build de production** (`npm run build` puis
  `electron .`), jamais seulement en dev. Tuer Electron avant de relancer après rebuild.
- Pas de suite de tests automatisés à ce jour.
- Zone sensible (secrets, IPC exposant un accès système, permissions, mise à jour auto) :
  `qa-log-auditor` passe à chaque changement.

## Multiplateforme

Chemins via `path.join`, raccourcis `CmdOrCtrl`, pas de supposition sur la casse du FS.
