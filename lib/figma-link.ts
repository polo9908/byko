/**
 * MCP-3 — construction du deep-link Figma (fonction pure, sans outil MCP dédié).
 *
 * BACK-8 a besoin d'un lien unique vers un composant du design system, format :
 * `https://www.figma.com/file/<clé>/<nom>?node-id=<id>` (énoncé BACK-8, ligne 206).
 *
 * Choix documentés, faute de sonde réelle dans cet environnement :
 * - le NOM de fichier n'est pas connu du connecteur : on émet la forme sans slug de nom,
 *   `https://www.figma.com/file/<fileKey>?node-id=<nodeId>`, que Figma accepte (il résout
 *   la clé de fichier seule) ;
 * - `nodeId` est passé TEL QUEL, sans encodage : les identifiants de nœuds Figma contiennent
 *   « : » (ex. `123:456`), et ce caractère est un sub-delim autorisé dans une valeur de
 *   requête. Les liens générés par l'interface Figma remplacent parfois « : » par « - » ;
 *   les deux formes sont acceptées, et n'encoder ni remplacer évite de prétendre un
 *   comportement non sondé. À confirmer sur un vrai cas au premier test manuel (critère
 *   BACK-8 : « le deep-link généré ouvre effectivement le bon composant »).
 *
 * Aucun import runtime : testable sans réseau ni coffre.
 */

/** Précision : tout autre format serait une invention non sondée — voir l'en-tête. */
const FIGMA_FILE_URL_PREFIX = "https://www.figma.com/file/";

/**
 * Construit le deep-link vers un nœud précis d'un fichier Figma.
 *
 * `fileKey` et `nodeId` sont les valeurs renvoyées par l'outil de recherche du design
 * system (MCP `search_design_system`) : ce module ne les fabrique jamais, il ne fait que
 * composer l'URL.
 */
export function buildFigmaDeepLink(fileKey: string, nodeId: string): string {
  return `${FIGMA_FILE_URL_PREFIX}${fileKey}?node-id=${nodeId}`;
}
