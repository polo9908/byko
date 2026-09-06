# Gabarit du message de clarification (ARCHI-5)

Gabarit fixe du message de clarification, affiché quand le verdict d'analyse n'est pas
« coherent » (Réserves mineures ou Cassure risquée). Ce fichier est la **seule source de
vérité** du texte : l'IA ne rédige que la liste des questions, jamais l'intro ni la
structure.

`[CLÉ]` désigne la clé du ticket analysé (ex. `PROJ-123`). Elle est remplacée telle quelle,
à l'identique : l'IA ne la devine pas, ne la reformate pas, ne la décore pas.

## Variantes d'intro

Le nombre de questions décide de l'intro, et de lui seul. Rien d'autre n'entre en compte.

### Une seule question

```
Bonjour, une précision avant de démarrer [CLÉ] : <question>
```

Pas de liste numérotée : l'unique question suit l'intro, séparée par un espace.

### Deux questions ou plus

```
Bonjour, avant de démarrer [CLÉ], quelques précisions sont nécessaires :
1. <première question>
2. <deuxième question>
…
```

## Ce que l'IA remplit

Uniquement la liste des questions (ou l'unique question, au singulier). Rien d'autre. Elle
ne réécrit jamais l'intro, ne change jamais la numérotation, n'ajoute ni titre, ni
transition, ni signature.

## Invariants de ton et de structure

Ils garantissent le critère d'acceptation « deux analyses différentes produisent un message
reconnaissable comme venant du même outil » :

- L'intro est un texte **figé**, jamais paraphrasé. Le « Bonjour, » d'ouverture et la
  virgule de politesse font partie de la formule, pas du contenu.
- L'intro se termine toujours par « : » (deux-points), jamais par « ? », « ! » ou un point.
- La liste est toujours numérotée « 1. », « 2. », … — jamais de puces, jamais de « - »,
  jamais une autre numérotation.
- Chaque question tient sur une seule ligne, commence par une majuscule, se termine par
  « ? ». Aucune phrase intermédiaire entre l'intro et la liste.
- Aucune formule de politesse finale (« Merci », « Cordialement »), aucune signature,
  aucune mention de l'outil ni du modèle.
- Le ton est **interrogatif et neutre** : on pose des questions, on ne propose pas de
  réponse, on ne commente pas le ticket, on ne porte pas de jugement.

## Cas « aucune question »

Le gabarit n'est utilisé que lorsque le verdict n'est pas « coherent », donc avec au moins
une question. Le constructeur `lib/prompts/clarification.ts` reste néanmoins **défensif** :
zéro question → chaîne vide `""` (aucun message de clarification), jamais une intro
orpheline sans contenu.

Le constructeur est la traduction exécutable et testable de ce gabarit ; il ne contient
aucune logique IA et doit rester aligné sur les chaînes ci-dessus.
