/**
 * ARCHI-3 — Valeur secrète en mémoire (jetons Jira, Figma, IA).
 *
 * Complément du stockage chiffré (`lib/token-storage.ts`), sur l'autre moitié du critère
 * d'acceptation d'ARCHI-3 (`docs/tickets/phase-1-configuration.md`, lignes 91 et 95) :
 * le chiffrement protège le jeton SUR LE DISQUE, ce module le protège EN MÉMOIRE, sur les
 * deux chemins de fuite que le typage ne peut pas fermer — un `console.log` et une réponse
 * JSON.
 *
 * CE QUE ÇA FERME. Un `Secret` ne porte sa valeur dans AUCUNE propriété : elle vit dans un
 * champ privé `#value`, hors de portée de `Object.keys`, du spread, de `JSON.stringify` et
 * de `util.inspect`. Les trois chemins par lesquels une valeur s'échappe sans qu'on l'ait
 * demandé rendent donc le masque, pas le jeton :
 *
 * ```ts
 * console.log(secret);                  // Secret(••••4f2a)
 * console.log(`jeton=${secret}`);       // jeton=••••4f2a
 * NextResponse.json({ ...credentials }) // {"apiToken":"••••4f2a"}
 * ```
 *
 * Ce dernier cas est exactement le raccourci que `docs/api-contracts.md` (§Jetons) décrit
 * comme compilant sans erreur et échappant à `lint`, `tsc` et `build`. Il reste une faute,
 * mais il ne produit plus de fuite si la valeur est un `Secret`.
 *
 * CE QUE ÇA NE FERME PAS — à lire avant de s'y fier :
 * - **La protection ne vaut que pour les valeurs enveloppées.** Un jeton lu depuis
 *   `await request.json()` est une `string` nue : il n'est protégé qu'à partir de l'appel à
 *   `createSecret()`. Envelopper au plus tôt, à la frontière de parsing, est à la charge de
 *   BACK-1/2/3/4.
 * - **`revealSecret()` rend la valeur en clair, par conception** : les tests de connexion en
 *   ont besoin pour construire un en-tête HTTP. C'est la porte de sortie, volontairement
 *   unique et nommée pour être cherchable (`grep revealSecret`) — l'audit lit ses appels un
 *   par un. Cette unicité tient parce que `SecretBox` n'expose **aucune méthode statique** :
 *   la classe n'est pas exportée, mais `secret.constructor` la joint à l'exécution, et une
 *   statique publique y serait donc appelable sans passer par `revealSecret` (défaut relevé
 *   en revue croisée le 04/09/2026 et corrigé ici). Toute statique ajoutée à cette classe
 *   rouvrirait le chemin.
 * - **Le masque n'est pas une empreinte.** `••••4f2a` montre les 4 derniers caractères du
 *   jeton, comme le font GitHub ou Stripe. Deux jetons distincts peuvent donc porter le même
 *   masque, et le masque ne doit jamais servir de clé d'identification.
 *
 * Aucun import : ce module est utilisable côté serveur comme côté client.
 */

/** Caractères de fin laissés visibles dans le masque. */
const VISIBLE_TAIL = 4;

/**
 * En dessous de cette longueur, aucun caractère n'est montré. Montrer 4 caractères d'un
 * jeton de 6 en dévoilerait les deux tiers ; les jetons réels des trois sources sont très
 * au-dessus de ce seuil, il ne se déclenche donc que sur une saisie tronquée ou fautive.
 */
const MIN_LENGTH_FOR_TAIL = 12;

const MASK_BULLETS = "••••";

/**
 * `util.inspect` de Node consulte ce symbole AVANT `toString()` — sans lui,
 * `console.log(secret)` afficherait la structure interne de l'objet et non le masque.
 * Obtenu par `Symbol.for` (registre global) plutôt qu'en important `node:util`, pour que ce
 * fichier reste sans import et donc utilisable côté client.
 */
const INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Accesseurs installés par le bloc statique de `SecretBox`, dans la portée du module.
 *
 * Ils ne sont PAS des méthodes statiques de la classe : `SecretBox` n'est pas exportée, mais
 * `secret.constructor` la rend joignable depuis n'importe où à l'exécution. Une statique
 * publique `SecretBox.reveal` ouvrirait donc une seconde sortie en clair
 * (`secret.constructor.reveal(secret)`), invisible d'un `grep revealSecret` — exactement la
 * garantie que l'en-tête revendique. Dans la portée du module, il n'y a rien à joindre.
 */
let readValue: (secret: SecretBox) => string;
let readMask: (secret: SecretBox) => string;
let hasBrand: (candidate: unknown) => candidate is SecretBox;

class SecretBox {
  /**
   * Champ privé ECMAScript, pas une convention de nommage : il est inaccessible depuis
   * l'extérieur de la classe, invisible de `Object.keys`, du spread, de `JSON.stringify` et
   * de `util.inspect`. C'est lui qui fait qu'une fuite accidentelle est impossible plutôt
   * qu'improbable. Il rend aussi le type NOMINAL pour TypeScript : un objet de même forme
   * n'est pas assignable à `Secret`.
   */
  readonly #value: string;

  /** Calculé une fois : le masque ne doit pas dépendre de l'endroit où il est demandé. */
  readonly #mask: string;

  constructor(value: string) {
    this.#value = value;
    this.#mask = computeMask(value);
  }

  /**
   * Seul endroit d'où `#value` est atteignable. Le bloc statique s'exécute une fois, à
   * l'évaluation de la classe ; la classe elle-même n'expose aucune statique, donc
   * `secret.constructor` ne mène nulle part.
   */
  static {
    readValue = (secret) => secret.#value;
    readMask = (secret) => secret.#mask;
    /** Contrôle de marque ECMAScript : vrai uniquement pour une instance réelle. */
    hasBrand = (candidate): candidate is SecretBox =>
      typeof candidate === "object" && candidate !== null && #value in candidate;
  }

  /** Concaténation, littéral de gabarit, `String(...)`. */
  toString(): string {
    return this.#mask;
  }

  /** `JSON.stringify`, donc `NextResponse.json`, donc l'écriture sur disque. */
  toJSON(): string {
    return this.#mask;
  }

  [INSPECT_CUSTOM](): string {
    return `Secret(${this.#mask})`;
  }
}

/**
 * Un jeton en mémoire. Type nominal : `const s: Secret = "figd_…"` ne compile pas, et un
 * objet écrit à la main non plus — seul `createSecret()` en produit.
 */
export type Secret = SecretBox;

function computeMask(value: string): string {
  return value.length >= MIN_LENGTH_FOR_TAIL
    ? `${MASK_BULLETS}${value.slice(-VISIBLE_TAIL)}`
    : MASK_BULLETS;
}

/**
 * Enveloppe une valeur sensible. À appeler au plus tôt — idéalement sur la ligne qui lit le
 * corps de la requête — pour que la fenêtre pendant laquelle le jeton est une `string` nue
 * soit la plus courte possible.
 *
 * La chaîne d'origine n'est ni copiée ailleurs, ni normalisée, ni journalisée.
 */
export function createSecret(value: string): Secret {
  return new SecretBox(value);
}

/**
 * Rend la valeur en clair. **Seule sortie possible**, et le seul appel qu'un audit ait à
 * relire : à n'utiliser que pour construire un en-tête d'authentification ou pour écrire
 * dans le coffre chiffré, jamais pour journaliser, ni pour composer un message d'erreur,
 * ni pour remplir une réponse d'API.
 */
export function revealSecret(secret: Secret): string {
  return readValue(secret);
}

/**
 * Empreinte d'affichage — `••••4f2a` — destinée à l'écran et aux traces. Ce n'est pas un
 * identifiant : deux jetons peuvent partager le même masque (§en-tête).
 */
export function maskSecret(secret: Secret): string {
  return readMask(secret);
}

/**
 * Vrai uniquement pour une valeur produite par `createSecret()`. Utilisé par
 * `lib/token-storage.ts` pour refuser d'écrire un `Secret` non déballé sur le disque —
 * ce qui y écrirait le masque à la place du jeton.
 */
export function isSecret(candidate: unknown): candidate is Secret {
  return hasBrand(candidate);
}
