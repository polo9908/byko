# Politique XSS — rendu du contenu externe

## Règle

Tout texte provenant de Jira (titre, description, commentaires) ou généré par un provider IA (traduction en langage clair, questions de clarification) doit être rendu par interpolation JSX normale — `{texte}` — jamais par `dangerouslySetInnerHTML` ni par toute autre injection de HTML brut.

React échappe automatiquement le contenu interpolé dans `{...}`. C'est cette protection par défaut que la règle préserve, plutôt que de compter sur la vigilance de chaque développeur à chaque écran.

## Application

- Règle ESLint `react/no-danger` (`error`) dans `eslint.config.mjs` : `pnpm run lint` échoue si `dangerouslySetInnerHTML` apparaît n'importe où dans le code applicatif. Pas de liste blanche — aucun écran n'a besoin d'en injecter.
- Content Security Policy restrictive posée dans les headers de réponse (`next.config.ts`), en couche défensive supplémentaire — un filet de sécurité, pas une correction de faille.

## Risque résiduel

Cette politique protège le rendu côté front. Elle ne couvre pas l'injection de prompt côté IA (contenu Jira utilisé comme instruction plutôt que comme donnée) — ce risque est traité séparément par `ARCHI-8` et documenté dans `docs/architecture/prompt-safety.md`.
