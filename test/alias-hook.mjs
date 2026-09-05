/**
 * ARCHI-7 — Résolution de l'alias `@/` (et des imports relatifs entre fichiers de test),
 * pour `node --test`.
 *
 * Les modules de `lib/` s'importent entre eux par l'alias `@/…` (`import { isSecret } from
 * "@/lib/secret"`). Cet alias est déclaré dans `tsconfig.json` (`compilerOptions.paths`),
 * ce qui ne vaut QUE pour TypeScript et pour le bundler de Next : le résolveur ESM de Node
 * ne le connaît pas et échouerait en `ERR_MODULE_NOT_FOUND` dès le premier `import` d'un
 * fichier de `lib/` par la suite de tests.
 *
 * Deux issues étaient possibles ; celle-ci est la seule qui respecte les contraintes du
 * ticket (aucune dépendance ajoutée, aucun fichier de `lib/` modifié) :
 * - réécrire les imports de `lib/` en chemins relatifs : refusé, ce serait modifier le code
 *   audité pour le confort du test — exactement ce qu'un test de non-régression ne doit
 *   pas faire ;
 * - un hook de résolution ESM natif, chargé avant la suite par `--import` : retenu.
 *
 * ÉTENDU AUX IMPORTS RELATIFS ENTRE FICHIERS DE TEST (`./helpers/...`) — pas seulement à
 * `@/` — pour une raison qui n'est PAS `lib/` : `tsc --strict` (sans
 * `allowImportingTsExtensions`, une option de `tsconfig.json` qui reste hors périmètre)
 * refuse un import se terminant par `.ts` (`TS5097`), alors que le résolveur ESM natif de
 * Node exige, lui, une extension explicite sur un spécificateur relatif (pas de recherche
 * implicite, contrairement à `@/`). Les deux contraintes ne laissent qu'une issue commune :
 * des imports relatifs SANS extension entre fichiers de `test/`, et ce hook complète
 * l'extension manquante — même mécanisme que pour `@/`, juste sans le préfixe à retirer.
 * Vérifié : sans cette extension, `import("./helpers/temp-vault")` échoue en
 * `ERR_MODULE_NOT_FOUND` ; avec `.ts` écrit en dur, `tsc --strict` échoue en `TS5097`.
 *
 * `registerHooks` (natif, `node:module`) plutôt que `register` : les hooks synchrones
 * s'exécutent dans le même fil que le chargement, donc sans thread de travail ni canal de
 * message à amorcer. Vérifié disponible sur le poste (Node v26.7.0, `typeof
 * require("node:module").registerHooks === "function"`). Ce fichier est en `.mjs` et non en
 * `.ts` parce qu'il doit être chargé AVANT toute machinerie de test.
 *
 * Le hook ne fait qu'une chose : traduire le préfixe `@/` en chemin depuis la racine du
 * dépôt et retrouver l'extension que TypeScript laisse implicite. Tout le reste — y compris
 * le retrait des types, natif sur Node 26 (vérifié : un fichier `.ts` de `lib/` s'importe
 * sans transformation préalable une fois le chemin résolu) — est laissé au résolveur
 * d'origine.
 *
 * PIÈGE CORRIGÉ ICI (relevé à la relecture, avant tout usage par la suite) : `existsSync()`
 * répond `true` aussi bien pour un fichier que pour un RÉPERTOIRE. `@/lib/types` désigne un
 * répertoire réel (`lib/types/`) ; le code d'origine l'aurait résolu vers ce répertoire tel
 * quel et l'aurait transmis à `nextResolve`, qui aurait échoué en
 * `ERR_UNSUPPORTED_DIR_IMPORT` au lieu d'essayer `lib/types.ts` (qui n'existe pas non plus
 * ici, mais la distinction compte pour tout futur alias de cette forme). Vérifié par sonde
 * jetable : `import("@/lib/types")` sans ce correctif lève bien `ERR_UNSUPPORTED_DIR_IMPORT`.
 * Aucun import du dépôt n'emprunte ce chemin aujourd'hui (seul `@/lib/types/settings` est
 * utilisé), donc rien ne change pour la suite actuelle ; corrigé quand même parce que le
 * comportement doit être correct, pas seulement inoffensif par absence de cas.
 *
 * Correctif : ne retenir un candidat que s'il désigne un FICHIER (`statSync(...).isFile()`),
 * jamais un répertoire — y compris pour `asWritten` (le chemin tel qu'écrit, sans extension
 * ajoutée), qui subissait le même trou.
 */

import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";

/** Racine du dépôt : ce fichier vit dans `test/`. Miroir de `paths: { "@/*": ["./*"] }`. */
const PROJECT_ROOT = new URL("../", import.meta.url);

const ALIAS_PREFIX = "@/";

/**
 * Extensions essayées quand l'import n'en porte pas. `.ts` d'abord : c'est la seule forme
 * présente dans `lib/` aujourd'hui, et l'ordre décide en cas d'homonymes.
 */
const IMPLICIT_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];

/** Vrai seulement pour un FICHIER réel — jamais pour un répertoire (voir en-tête). */
function isResolvableFile(url) {
  if (!existsSync(url)) {
    return false;
  }
  try {
    return statSync(url).isFile();
  } catch {
    // Disparu entre `existsSync` et `statSync`, ou inaccessible : pas un candidat valable.
    return false;
  }
}

/** Premier fichier réel trouvé pour `relativePath`, résolu depuis `base` ; `null` sinon. */
function resolveImplicitPath(relativePath, base) {
  const asWritten = new URL(relativePath, base);
  if (isResolvableFile(asWritten)) {
    return asWritten.href;
  }

  for (const extension of IMPLICIT_EXTENSIONS) {
    const candidate = new URL(`${relativePath}${extension}`, base);
    if (isResolvableFile(candidate)) {
      return candidate.href;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(ALIAS_PREFIX)) {
      const resolved = resolveImplicitPath(specifier.slice(ALIAS_PREFIX.length), PROJECT_ROOT);
      if (resolved !== null) {
        return nextResolve(resolved, context);
      }
      // Alias non résolu : on laisse le résolveur d'origine produire son erreur, qui nomme
      // le spécificateur fautif. En fabriquer une ici masquerait la vraie cause.
      return nextResolve(specifier, context);
    }

    // Imports relatifs SANS extension entre fichiers de `test/` (voir en-tête) : seulement
    // si un `parentURL` est connu — sans lui, rien à résoudre depuis, et le résolveur
    // d'origine gère déjà tout spécificateur absolu ou déjà pourvu d'une extension connue.
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      typeof context.parentURL === "string"
    ) {
      const resolved = resolveImplicitPath(specifier, context.parentURL);
      if (resolved !== null) {
        return nextResolve(resolved, context);
      }
    }

    return nextResolve(specifier, context);
  },
});
