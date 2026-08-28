# byko — Business Context Checker

Outil qui traduit le jargon métier d'un ticket Jira, détecte les incohérences avec l'historique, et recommande des composants Figma réutilisables.

## Stack

- Next.js (App Router) + TypeScript strict
- pnpm comme unique gestionnaire de paquets (`pnpm install`, `pnpm run <script>`, `pnpm add <package>`)

## Structure

```
app/          Routes Next.js (App Router)
app/api/      Route handlers (endpoints backend)
lib/          Logique métier, clients API
```

Aucun dossier n'est créé par anticipation : chaque dossier apparaît avec le premier ticket qui y place un fichier réel.

## Scripts

```
pnpm run dev      # serveur de développement
pnpm run build    # build de production
pnpm run lint     # ESLint
```
