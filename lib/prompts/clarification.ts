/**
 * ARCHI-5 — constructeur du message de clarification (fonction PURE, sans import).
 *
 * Le gabarit lui-même vit dans `lib/prompts/clarification-template.md` : c'est la source de
 * vérité du texte. Ce module n'en est que la traduction exécutable et testable — il ne
 * contient AUCUNE logique IA (pas de choix de ton, pas de reformulation, pas d'appel
 * réseau). La seule chose que l'IA remplit, la liste des questions, arrive en argument ;
 * tout le reste (intro, ponctuation, numérotation) est figé ici et doit rester aligné sur
 * le gabarit.
 *
 * Pourquoi une fonction plutôt qu'un simple gabarit de prompt : le gabarit est un document
 * destiné à l'IA (BACK-7), pas une unité testable. Ce constructeur permet de verrouiller la
 * conformité du texte par des tests (`test/clarification.test.ts`), indépendamment de ce que
 * l'IA produit — c'est le garant du critère « toujours conforme au gabarit ».
 */

/** Marqueur remplacé par la clé du ticket, identique à celui du gabarit. */
const CLE_PLACEHOLDER = "[CLÉ]";

/**
 * Intro pour une seule question. Le « Bonjour, » d'ouverture fait partie de la formule et
 * n'est PAS optionnel : c'est lui qui rend le message reconnaissable comme venant du même
 * outil, au singulier comme au pluriel.
 */
const SINGULAR_INTRO = "Bonjour, une précision avant de démarrer [CLÉ] :";

/**
 * Intro pour deux questions ou plus. Même formule d'ouverture que la variante singulière ;
 * seule la mention du nombre change (« quelques précisions sont nécessaires » vs « une
 * précision »).
 */
const PLURAL_INTRO =
  "Bonjour, avant de démarrer [CLÉ], quelques précisions sont nécessaires :";

/**
 * Construit le message de clarification conforme au gabarit.
 *
 * Règles (chacune documentée dans le gabarit, et verrouillée par un test) :
 * - 0 question → `""` : aucune clarification à afficher. Cas théoriquement impossible (le
 *   gabarit n'est utilisé que si le verdict n'est pas « coherent », donc avec au moins une
 *   question), mais traité défensivement pour ne jamais produire une intro orpheline.
 * - 1 question → variante singulière, question inline après l'intro, sans liste.
 * - ≥ 2 questions → variante plurielle suivie d'une liste numérotée « 1. », « 2. », …
 * - `[CLÉ]` est remplacé par `ticketKey` dans l'intro, à l'identique, sans reformatage.
 */
export function buildClarificationMessage(
  ticketKey: string,
  questions: readonly string[],
): string {
  if (questions.length === 0) {
    return "";
  }

  if (questions.length === 1) {
    const intro = SINGULAR_INTRO.replace(CLE_PLACEHOLDER, ticketKey);
    return `${intro} ${questions[0]}`;
  }

  const intro = PLURAL_INTRO.replace(CLE_PLACEHOLDER, ticketKey);
  const numbered = questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join("\n");
  return `${intro}\n${numbered}`;
}
