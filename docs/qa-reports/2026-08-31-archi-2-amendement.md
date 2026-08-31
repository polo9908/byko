# Audit — ARCHI-2, amendement du 31/08/2026 (clôture des 7 questions ouvertes)

Date : 2026-08-31 · Branche : `preprod` · Base : `c0b74f0` · Agent audité : `backend-engineer`
(application des arbitrages), orchestrateur (deux corrections imposées), `frontend-integrator`
(relecture de consommabilité).
Portée relue : les modifications **non commitées** de `git diff`, soit `lib/types/settings.ts`
(423 l.) et `docs/api-contracts.md` (596 l.). Point de comparaison :
[`2026-08-29-archi-2.md`](2026-08-29-archi-2.md) (audit + contre-vérification).
Zone sensible (jetons, persistance durable) : audit ticket par ticket.

## Verdict

**À SURVEILLER** — aucun bloquant. 2 constats à surveiller, 5 mineurs.
Aucune fuite de jeton, aucune donnée inventée, aucune référence de ligne fausse, aucune
régression sur les points déclarés levés le 29/08.

## Vérifications (sorties réelles)

| Vérification | Résultat |
| --- | --- |
| `pnpm run lint` | passe — `$ eslint`, aucune sortie, exit 0 |
| `pnpm exec eslint . --max-warnings=0` | passe — exit 0 (zéro avertissement, pas seulement zéro erreur) |
| `pnpm exec tsc --noEmit` | passe — aucune sortie, exit 0 |
| `pnpm run build` | passe — Next.js 16.3.3 (Turbopack), `✓ Compiled successfully in 128ms`, `Finished TypeScript in 706ms`, 4/4 pages, exit 0 |
| Tests | **non exécutés** — aucun script `test` dans `package.json` (`dev`, `build`, `start`, `lint`). Constaté, non créé, non contourné. |
| `audit:console` / console navigateur | **non exécutée** — script inexistant, et ce ticket ne livre ni endpoint ni écran. Aucun serveur démarré. `.next` produit par le build a été supprimé. |
| `git status --porcelain` | ` M docs/api-contracts.md`, ` M lib/types/settings.ts` — **exactement les deux fichiers annoncés**, aucun fichier non suivi, aucune sonde laissée dans le dépôt |
| Motifs de jeton sur les fichiers modifiés (`ATATT`, `figd_`, `sk-`, `gh[pousr]_`, `AIza`, `xox[baprs]-`, `Bearer …`, JWT, clé privée PEM) | aucune correspondance (exit 1) |
| `apiToken` dans `lib/` | 3 occurrences, l. 75, 80, 86 — les trois `*Credentials`, toutes en **entrée** |

`npm` n'a été utilisé à aucun moment. Sondes hors dépôt, dans le scratchpad de session.

## Sondes de compilation (`tsc --noEmit --strict`)

| Sonde | Attendu | Résultat |
| --- | --- | --- |
| p1 — clés récursives : `Extract<AllKeys<T>, "apiToken"\|"token"\|"credentials"\|"secret"\|"password">` = `never` sur `GetSettingsResponse`, `SettingsState`, `TestConnectionResponse`, `SaveSettingsResponse` | exit 0 | **exit 0** |
| p1 — contrôles positifs de l'utilitaire (`apiToken` atteint dans `TestConnectionRequest` ; `accountName`, `lastError`, `message` atteints dans `SettingsState`) | exit 0 | **exit 0** — les assertions négatives ci-dessus ne sont donc pas vides |
| p1 — `keyof PersistedConnectionError<…>` ⊆ `{message, code}` | exit 0 | **exit 0** |
| p2 — 12 `@ts-expect-error` (dont : `status:"pending"`, `lastError` sur `connected` ×2 et sur `skipped`, `message` manquant, code Figma sur Jira, code Jira sur l'IA, `st.jira.lastError` sans narrowing, `skipped` sur Jira et sur l'IA, `block` manquant sur `SaveSettingsResponse`, `apiToken` dans `lastError`) | exit 0, **toutes les directives consommées** | **exit 0** — aucune TS2578 |
| p3 — narrowing de `lastError` sans cast sur les 3 blocs, exhaustivité `never` sur `TestConnectionResponse` (2 statuts) et `FigmaSettingsState` (3 statuts) | exit 0 | **exit 0** |
| p4 — `import type { TestConnectionPending }` | échec | **exit 2** — `TS2305: has no exported member 'TestConnectionPending'` |
| p5 — marqueur d'onboarding : écriture `{block:"onboarding"}`, lecture `s.onboardingCompleted`, `g.onboardingCompleted` | 3 `@ts-expect-error` consommées | **exit 0** — le manque B1 est réel |
| p6 — `lastError` posé sur `skipped`/`connected` **via une variable** | — | **exit 0** — le refus n'est pas structurel (cf. mineur 5) |
| p7 — `PersistedConnectionError` sans argument de type | échec | **exit 0**, directive consommée → `TS2314` confirmé (cf. mineur 3) |

## Zone jetons — ce qui a été vérifié

- `lastError` est déclaré **exactement 3 fois** (`settings.ts:308, 325, 341`), toutes sur la
  variante `not_connected`. Nulle part ailleurs. Conforme à la décision n°3.
- **Aucun champ jeton en sortie, y compris par imbrication** : vérifié par énumération
  récursive des clés (p1), avec contrôles positifs prouvant que l'utilitaire traverse bien
  les types imbriqués. `PersistedConnectionError` ne porte que `message` et `code`.
- Le document **ne surestime ni ne sous-estime** le risque : il dit que le typage ne le couvre
  pas (`docs/api-contracts.md:61-65`), que la persistance le rend durable et relu à chaque
  `GET` (l. 67-71), et il attribue nommément les charges — **rédaction BACK-1/2/3** (l. 73-76),
  **persistance BACK-4** (l. 77-82). `settings.ts:26-30` et `273-276` disent la même chose,
  avec les mêmes porteurs. Le défaut doc/code qui avait produit le bloquant du 29/08 n'est pas
  reproduit — sauf sur un point local, constat 1 ci-dessous.
- Le rattachement au critère d'acceptation de BACK-4 (l. 183 : « `GET /api/settings` ne
  contient jamais de jeton en clair, y compris dans les logs de requête ») est exact : la
  ligne existe et couvre bien ce champ.

## Constats

### [à surveiller] `settings.ts:302` — « Aucun jeton ici … elle reste absente » est devenu faux avec l'ajout de `lastError`

`lib/types/settings.ts:302`, dernier paragraphe du commentaire de `JiraSettingsState` :
« Aucun jeton ici : ARCHI-3 n'interdit que sa valeur, et elle reste absente. »

Cette phrase pré-existe à l'amendement, mais l'amendement l'a rendue fausse : `lastError` a
été ajouté 6 lignes plus bas, sur ce type précis, et son `message` est une chaîne libre.
La même valeur peut donc y être présente. Le fichier se contredit :

- l. 26-30 (en-tête) : le `message` persisté est un « NON GARANTI » explicite ;
- l. 350-351 (`SettingsState`) : « `lastError.message` … c'est le **seul** champ de
  `SettingsState` par lequel un jeton pourrait transiter par accident » ;
- l. 302 (`JiraSettingsState`) : « elle reste absente ».

Reproduction : lire le fichier à partir de l. 283 (bloc de commentaire de `JiraSettingsState`)
sans remonter à l'en-tête — c'est la lecture normale d'un implémenteur BACK-4 qui vient typer
son état Jira. Il y trouve une garantie d'absence là où l'en-tête pose une obligation.

C'est la même classe de défaut que le bloquant du 29/08, à une échelle moindre : garantie
locale, contredite ailleurs dans le même fichier, dans la zone la plus sensible. Correction
attendue : aligner l. 302 sur la formulation déclarative de l'en-tête (aucun champ jeton
n'est *déclaré* ; `lastError.message` reste une chaîne libre).

**Né du correctif audité → pas de ticket, à corriger avant le commit.**

### [à surveiller] La convention HTTP étendue à `GET /api/settings` rend indécidable le cas « configuration illisible »

`docs/api-contracts.md:127-159` (convention, étendue aux trois endpoints) vs `219-233`
(variante d'erreur de `GetSettingsResponse`).

La convention dit : « un appel qui aboutit renvoie `200` », « `4xx`/`5xx` réservés aux requêtes
malformées et aux **défaillances serveur** — … exception non rattrapée », puis (l. 150-155)
« quand `res.ok === false` … il n'y a **pas de verdict** : le front rend une panne de
transport ».

Or `GetSettingsResponse` porte `{ status: "error", message }` pour un cas qui est exactement
une défaillance serveur : fichier chiffré illisible, clé de chiffrement absente (l. 229-231).
Rien ne dit à BACK-4 s'il doit répondre `200` + `status:"error"` (échec rattrapé, donc verdict)
ou `500`. Les deux lectures sont défendables avec le texte livré.

Conséquence si BACK-4 choisit `500` : le front, en appliquant la convention à la lettre, ignore
un corps pourtant conforme et jette le `message` — alors que ce `message` est requis
précisément pour que l'affichage soit précis (`settings.ts:366-367`). Conséquence si un autre
endpoint choisit l'inverse : la divergence d'implémentation que la décision n°4 cherche à
empêcher.

Ce qui n'est **pas** en cause : le wizard n'est pas resservi à un utilisateur configuré dans
l'un ou l'autre cas — la convention distingue bien « panne de transport » de « aucune
configuration ».

Correction attendue : une phrase dans le § convention disant, pour `GET /api/settings`, si un
échec de lecture rattrapé est un `200` avec verdict ou un `5xx`.

**Né du correctif audité** (la généralisation aux trois endpoints est introduite par cet
amendement, et déclarée comme telle l. 131-137) **→ pas de ticket, à corriger avant le commit.**

### [mineur] `PersistedConnectionError` est cité sans son argument de type, il n'est pas utilisable tel quel

`docs/api-contracts.md:251` et `411`, `lib/types/settings.ts:275`. Le type est générique
(`<TCode extends string>`) sans paramètre par défaut : `const e: PersistedConnectionError = …`
échoue en `TS2314` (sonde p7). Un consommateur front doit écrire
`PersistedConnectionError<JiraTestConnectionErrorCode>`. Le document ne le montre nulle part.

### [mineur] Le formatage FRONT-5 est présenté comme tranché à un endroit, comme à confirmer à l'autre

`docs/api-contracts.md:281-284` : « le Récap affiche **le domaine de l'`instanceUrl` saisie** »,
énoncé comme le contenu de l'arbitrage. `docs/api-contracts.md:294-297` : « **Lecture retenue,
à confirmer** — … n'afficher que le nom d'hôte, sans le schéma ». Même dualité aux l. 463 et
466-468 (décision n°7). « Le domaine » et « le nom d'hôte sans schéma » désignent la même
chose : la première formulation présente comme acquis ce que la seconde déclare à confirmer.
La correction imposée par l'orchestrateur est donc restaurée dans un paragraphe et défaite
dans celui qui le précède. Un FRONT-5 qui ne lit que le premier saute l'étape de confirmation
sur la maquette.

### [mineur] « bien refusé sur `connected` et sur `skipped` » : vrai pour un littéral frais seulement

`docs/api-contracts.md:583-584`, entrée de revue de consommabilité. Le refus est réel pour un
littéral frais (sonde p2 : 3 directives consommées), mais tombe dès que la valeur transite par
une variable — `const o = { status: "skipped" as const, lastError: { message: "m" } };
const s: FigmaSettingsState = o;` compile (sonde p6, exit 0). Même mécanisme d'excess property
check que celui que le § Jetons décrit correctement l. 31-42, et même classe de formulation
absolue que les deux mineurs de la contre-vérification du 29/08. Aucune conséquence
d'affichage : c'est un journal, pas une règle d'implémentation.

### [mineur] La charge BACK-4 du § Risque résiduel ne nomme que la concaténation

`docs/api-contracts.md:77-78` : « Ne persiste que le `message` fourni par le test, sans le
concaténer avec le corps de requête. » Le chemin le plus banal n'est pas la concaténation mais
la réutilisation d'un objet : `const raw = { message: "échec", apiToken: "…" };
const s: JiraSettingsState = { status: "not_connected", lastError: raw };` compile (sonde p3e)
et écrit le jeton sur disque. Ce cas est bien couvert par l'obligation générale l. 44-47, qui
nomme BACK-4 — il n'est simplement pas rappelé là où le risque durable est décrit.

### [mineur] Le « pourquoi » de FRONT-4 est dérivé du libellé d'exemple, pas du texte de l'exigence

`lib/types/settings.ts:260-262` et `docs/api-contracts.md:256` : « FRONT-4 (ligne 266) doit
dire *pourquoi* un bloc bloque, pas seulement *lequel* ». La ligne 266 de
`docs/tickets/phase-1-configuration.md` écrit littéralement « explique précisément quel bloc
bloque » ; le « pourquoi » ne vient que du libellé donné en exemple entre parenthèses
(« … le jeton du Modèle IA est invalide »). La lecture est défendable et le document la
qualifie correctement ailleurs (l. 521-522, « libellé de référence »), mais c'est cette lecture
qui porte à elle seule la justification d'un ajout au contrat.

## Non-invention — références vérifiées une à une

Les 23 références de ligne du diff ont été ouvertes dans les fichiers cités.
`docs/tickets/phase-1-configuration.md` : règle produit l. 9, 10, 12 ; ARCHI-2 l. 49
(`"success" | "error" | "pending"` — exact) ; ARCHI-2b l. 68 ; ARCHI-3 l. 95 ; BACK-1 l. 113 ;
BACK-2 l. 139 ; BACK-4 l. 178, 179, 183 ; FRONT-1 l. 200, 204 ; FRONT-2 l. 221 ;
FRONT-3 l. 245, 246, 251 ; FRONT-4 l. 265, 266 ; FRONT-5 l. 288, 292, 293, 296 ;
FRONT-6 l. 307. `docs/tickets/phase-3-parametres.md` : FRONT-12 l. 67.
**Toutes exactes.** Aucune n'est attribuée au mauvais ticket.

Autres affirmations sourçables, vérifiées :

- « Aucun des tickets BACK-1/2/3 ne décrit le renvoi d'un `pending` » (l. 121) — exact.
- « aucun critère d'acceptation de la phase 1 n'exige la suppression d'un jeton » (l. 432-433)
  — exact, relu ticket par ticket.
- « La liste de dépendances de FRONT-5 (l. 296) ne cite que FRONT-4 et BACK-4 » (l. 541) — exact.
- « FRONT-5 (l. 288) ne prévoit que deux libellés : `Connecté` et `Passé` » (l. 530) — exact.
- Table de dérivation d'URL (l. 307-312) : **rejouée à l'exécution**, les 4 lignes sont exactes,
  y compris `"axara.atlassian.net"` → `ERR_INVALID_URL`.
- `axara.atlassian.net` : 6 occurrences, toutes dans `docs/api-contracts.md`, **aucune dans
  `lib/`**. Présenté explicitement comme un exemple de maquette et non comme une valeur du
  produit (l. 299-301), et aucun champ ni aucune valeur du contrat n'en dépend.

Aucune valeur en dur, aucune fixture, aucun champ inventé, aucun texte plausible fabriqué.

## Non-régression (points déclarés LEVÉS le 29/08)

| Point | État |
| --- | --- |
| `block` requis sur `SaveSettingsResponse` | tient — `settings.ts:420-422`, sonde p2 |
| `RequiredConnectionStatus` supprimé | tient — plus aucune occurrence hors journal (l. 564) |
| Garantie jetons requalifiée au niveau déclaratif | tient — `settings.ts:9-24`, doc l. 25-52 (sauf constat 1) |
| `skipped` structurellement interdit sur Jira et l'IA | tient — sonde p2, 2 directives consommées |
| Aucune occurrence orpheline de `pending` | tient — les 12 occurrences restantes documentent toutes le retrait ; `TestConnectionPending` n'est plus exporté (p4) |

## Sincérité du journal de revue

`docs/api-contracts.md:568-595`. Vérifié :

- « Portée : `lib/types/settings.ts` et ce document, aucun autre fichier » — **exact**
  (`git status --porcelain`).
- « **Audit** — non réalisé pour cet amendement à la date de rédaction » (l. 590) — **présent**.
  L'entrée ne s'attribue aucun audit.
- « `pnpm run lint`, `pnpm exec tsc --noEmit` et `pnpm run build` passent » (l. 593-594) —
  **reproduit, exact**.
- « Aucun script `test` n'existe dans `package.json` ; aucun n'a été créé » — **exact**.
- « `TestConnectionPending` supprimé, `PersistedConnectionError` + `lastError` sur les
  variantes `not_connected`, divergence n°4 ajoutée » — **exact**, vérifié par compilation.
- Le manque bloquant B1 (marqueur d'onboarding) est réel et non comblé par un champ inventé :
  sonde p5, lecture **et** écriture refusées par la compilation, conformément à la décision
  n°2 qui déclare `lib/types/settings.ts` volontairement non modifié sur ce point.

## Tickets ouverts

**Aucun.** Les deux constats « à surveiller » naissent du correctif audité (l'un rendu faux par
l'ajout de `lastError`, l'autre par la généralisation de la convention HTTP introduite ici) :
ils se corrigent dans cette livraison, avant commit, et n'ouvrent pas de dette pré-existante.
Aucun constat mineur n'ouvre de ticket.

## Non couvert

- **Aucun comportement d'exécution.** Ce ticket ne livre que des types : ni endpoint, ni route
  handler, ni écran, ni composant. Rien n'a été démarré, aucune requête n'a été émise, aucune
  console navigateur n'a été observée — et il n'y avait rien à y observer. Tout ce qui est
  affirmé ici sur le comportement vient de la compilation, pas d'une exécution.
- **Tests automatisés** : aucun script `test` dans `package.json`.
- **L'arbitrage produit du 31/08/2026 n'existe pas dans le dépôt.** Son contenu — les 7
  décisions, la citation « un test de connexion qui aboutit renvoie toujours `200` », le
  périmètre exact de ce qui a été tranché — n'est vérifiable par aucun fichier. Seule sa
  cohérence interne au document a été contrôlée. Si l'arbitrage réel diffère, cet audit ne
  peut pas le détecter.
- **La maquette est hors dépôt** (seul un lien `claude.ai` en tête de
  `phase-1-configuration.md`). L'artboard « 3 — Récap », le fait que le Récap affiche un
  domaine, la valeur `axara.atlassian.net` et l'absence de rendu pour Figma `not_connected`
  sont invérifiables ici.
- **La revue de consommabilité du 31/08** : son déroulement, son verdict « 5 écrans sur 6 » et
  la liste des champs envisagés puis écartés sont déclaratifs. Seules ses conclusions
  exprimables en types ont été rejouées (sondes p2, p3, p5, p6).
- **Le chiffrement d'ARCHI-3 n'existe pas encore.** L'affirmation que `lastError` sera protégé
  au repos (l. 78-79) est une projection sur un ticket non livré, non une propriété observable.
- **ARCHI-2b et ARCHI-3** : hors périmètre, non relus.
- **Les parties de `docs/api-contracts.md` sans lien avec l'amendement** ont été relues pour
  cohérence, mais la vérification ligne à ligne a porté sur le diff.
