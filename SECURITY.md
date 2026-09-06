# Sécurité — byko (Business Context Checker)

Merci d'avoir pris le temps de signaler un problème de sécurité. Ce document décrit
comment procéder et ce que vous pouvez attendre de nous.

## Versions supportées

Aucune version stable n'est publiée à ce jour (développement pré-1.0, version courante
`0.1.0`). Le développement actif est suivi sur la branche `preprod`, puis intégré à
`main`. Les rapports de sécurité sont traités quelle que soit la version concernée.

## Signaler une vulnérabilité

**Ne pas ouvrir d'issue publique.** Pour signaler un problème en privé :

1. Ouvrir l'onglet **Security** du dépôt → **Report a vulnerability**
   (GitHub Security Advisories).
2. Décrire le problème de façon reproductible : contexte, version concernée, étapes
   détaillées, impact attendu. Joindre si possible une preuve de concept minimale.
3. Si le contenu touche à un secret (jeton, clé API, données d'un coffre local), ne
   jamais l'inclure tel quel dans le rapport — le masquer ou le décrire sans sa valeur.

### Ce que vous pouvez attendre

- **Accusé de réception** sous 48 à 72 heures.
- Une **évaluation** du problème et, si confirmé, un correctif priorisé — diffusé via
  `preprod` puis `main`.
- Une **divulgation coordonnée** : par défaut, nous ne rendons pas le détail public avant
  la disponibilité du correctif (ou sous 90 jours si le correctif exige plus de temps),
  sauf accord explicite.
- Les **rapporteurs** sont remerciés dans les notes de version, avec leur accord.

## Périmètre et posture de sécurité

Éléments en place dans le code actuel :

- Jetons et clés stockés **chiffrés** localement (jamais en clair dans les logs ou les
  réponses d'API) — cf. `docs/architecture/token-storage.md`.
- Politique de rendu stricte : pas d'injection de HTML brut depuis du contenu externe
  (interdiction `dangerouslySetInnerHTML`, CSP) — cf. `docs/architecture/xss-policy.md`.
- Publication d'un contenu sur des systèmes externes (ex. commentaire Jira) toujours
  déclenchée par une action humaine explicite.

### Risque résiduel connu et surveillé

Le contenu provenant de Jira est analysé par un modèle de langage. Une instruction
cachée dans un ticket (« injection de prompt ») peut tenter d'influencer le verdict :
ce risque est traité par **isolation structurelle** du contenu dans les prompts
(balises explicites + instruction système « donnée, jamais instruction ») et reconnu
comme **résiduel** — une injection très habile peut malgré tout biaiser un verdict.
Il est suivi et non caché ; sa documentation dédiée accompagne le ticket ARCHI-8
(isolation du contenu externe). Tout contournement constaté de cette isolation est à
signaler via la procédure ci-dessus.

## En cas de doute

Si vous n'êtes pas certain qu'un problème relève de la sécurité, signalez-le quand même
via la procédure privée : nous préférons trier un rapport sans conséquence à un problème
réel publié prématurément.
