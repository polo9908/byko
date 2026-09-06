# Audit — Avenant BACK-4 : marqueur « onboarding terminé »

2026-09-06 · backend-engineer (avenant BACK-4) · Portée : `lib/types/settings.ts`,
`lib/settings-store.ts`, `lib/settings-mapper.ts`, `lib/settings-request.ts`,
`lib/settings-service.ts`, `docs/api-contracts.md`, et les quatre fichiers de test
afférents.

## Verdict

RIEN À SIGNALER

## Vérifications

| Vérification | Résultat |
| --- | --- |
| typecheck (`pnpm exec tsc --noEmit --strict`) | passe |
| lint (`pnpm run lint --max-warnings=0`) | passe |
| build (`pnpm run build`) | passe — 1 avertissement Turbopack **pré-existant** (`lib/token-storage.ts:891`, ticket #1), non introduit par cette livraison |
| tests (`pnpm run test`) | passe — 138 tests, 31 suites, 0 échec |
| console navigateur | non exécutée — pas de script `audit:console` dans `package.json`, et la livraison est strictement côté API (aucun composant front) |

## Constats

Aucun.

Points vérifiés sans réserve :

- **Rétrocompatibilité** : `decode()` lit `onboardingCompleted` absent comme `false`
  (coffre écrit avant l'avenant, même `schemaVersion` 1), et refuse une valeur non
  booléenne — testé dans `test/settings-store.test.ts`.
- **Transition à sens unique** : `POST /api/settings` n'accepte que le littéral
  `onboardingCompleted: true` ; `false` explicite est refusé à la frontière
  (`test/settings-request.test.ts`).
- **Pas de perte du marqueur** : les trois sauvegardes de bloc existantes recopient
  `base.onboardingCompleted` ; seule la variante onboarding le pose à `true`. Aucun chemin
  ne le ramène à `false`.
- **Pas de fuite de jeton** : le marqueur est un booléen, aucun `revealSecret()` ajouté
  hors des fonctions `encode…` existantes ; les nouveaux messages d'erreur sont des libellés
  fixes sans donnée sensible.
- **Concurrence** : la sauvegarde onboarding passe par `store.update()` (même file
  d'écriture partagée que les autres blocs), pas par un `read`+`write` naïf.
- **Périmètre** : aucune écriture hors du périmètre backend/contrat ; aucun fichier front
  créé.

## Non couvert

- **Console navigateur** : script `audit:console` absent du projet ; de toute façon sans
  objet sur une livraison 100 % API (aucun écran rendu).
- **Flux bout en bout UI** : « FRONT-5 marque l'onboarding terminé au clic du bouton
  final » dépend d'écrans front non encore livrés (FRONT-1/FRONT-5). L'écriture est
  néanmoins exercée au niveau du handler réel dans `test/settings-route.test.ts`
  (POST onboarding → GET reflète `onboardingCompleted: true`).
