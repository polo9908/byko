# Statut des connecteurs MCP

Document tenu à jour au fil des tickets connecteurs. Ne consigne que ce qui a été
réellement observé — jamais de format « probable ».

## Figma — `search_design_system`

**Ticket** : MCP-3 · **Dernière mise à jour** : 2026-09-06.

| Élément | État |
| --- | --- |
| Serveur MCP configuré dans l'environnement | **Non** (aucun `mcp.json` / serveur Figma) |
| Outil `search_design_system` appelable | **Non** — non sondé |
| Format exact des résultats | **Non observé** (contrat interne provisoire dans `lib/figma-search.ts`) |
| Seuils Recyclable / À vérifier / À créer | Non défini ici — règle de BACK-8 |
| Deep-link `buildFigmaDeepLink` | Implémenté (pur, testé) — à valider sur un vrai cas |
| Délai de rafraîchissement de l'index de recherche | Inconnu — à sonder |

### Ce qu'il faudra observer au premier serveur MCP Figma disponible

1. Nom exact de l'outil (`search_design_system`) et sa signature d'entrée.
2. Forme de la réponse : liste d'items ? enveloppe `{ items }` ? champs réels de chaque
   item (nom, score, clé de fichier, node id) et typage effectif (le `score` peut être un
   nombre ou une chaîne).
3. Valeurs réelles de `node-id` (présence de `:`), et si le lien `buildFigmaDeepLink`
   ouvre bien le bon composant (critère BACK-8).
4. Comportement d'erreur de l'outil : ce qui distingue une panne (quota, indisponibilité)
   d'une réponse vide — pour valider la distinction `panne ≠ aucun résultat` de
   `lib/figma-search.ts`.
5. Délai de rafraîchissement de l'index côté Figma (un composant ajouté n'apparaît pas
   immédiatement dans la recherche).

Tant que ces points ne sont pas observés, `lib/figma-search.ts` doit rester une couche
remplaçable (exécuteur injecté) : c'est par conception, pas un oubli.
