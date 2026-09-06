/**
 * MCP-3 — encapsulation de la recherche dans le design system (`search_design_system`).
 *
 * Le transport réel — l'appel à l'outil MCP Figma `search_design_system` — est INJECTÉ par
 * l'appelant (`execute`) : dans cet environnement aucun serveur MCP n'est configuré, donc
 * cette couche est volontairement remplaçable, et la forme exacte des résultats n'est PAS
 * encore observée. Le contrat interne ci-dessous est PROVISOIRE et minimal ; il est à figer
 * au premier appel réel (voir `docs/mcp-status.md`, créé par ce ticket).
 *
 * Ce que ce module garantit VRAIMENT, et qui est testé, c'est la distinction de BACK-8 /
 * critère d'acceptation MCP-3 : une panne de l'outil n'est JAMAIS présentée comme « aucun
 * résultat ». Un résultat vide (`[]` ou `items: []`) est un succès sans résultat ; un
 * exécuteur qui lève, ou une réponse dont la forme est inconnue, est une erreur explicite.
 * Les seuils Recyclable / À vérifier / À créer ne sont PAS une affaire de ce module : la
 * classification par score est la règle de BACK-8, qui consommera `score` brut.
 */

/** Un résultat de recherche, contrat PROVISOIRE (champs à figer au premier appel réel). */
export interface FigmaSearchResultItem {
  name: string;
  score: number;
  fileKey: string;
  nodeId: string;
}

export type FigmaSearchOutcome =
  | { status: "success"; items: FigmaSearchResultItem[] }
  | { status: "error"; message: string };

/** Exécuteur injecté : la façon de joindre l'outil MCP `search_design_system`. */
export type FigmaSearchExecutor = (
  tool: "search_design_system",
  args: { query: string },
) => Promise<unknown>;

/** Message d'erreur unique, sans recopie de contenu (jeton, requête, corps de réponse). */
const SEARCH_FAILURE_MESSAGE =
  "La recherche dans le design system a échoué (search_design_system).";

/** Une réponse dont la forme n'est pas reconnue n'est PAS « aucun résultat ». */
const SEARCH_UNRECOGNIZED_MESSAGE =
  "La réponse de search_design_system n'a pas une forme reconnue : format à figer au premier appel réel.";

/**
 * Normalise une valeur inconnue renvoyée par l'outil en liste provisoire d'items.
 *
 * Forme attendue (provisoire) : un tableau, ou un objet `{ items: [...] }`. Chaque entrée
 * est lue sans hypothèse sur son typage exact : les champs attendus sont extraits s'ils
 * existent sous forme primitive, sinon l'entrée est ignorée — jamais un `throw` sur un
 * champ manquant, jamais une valeur inventée pour combler un trou.
 */
function extractItems(value: unknown): FigmaSearchResultItem[] | null {
  const raw =
    Array.isArray(value)
      ? value
      : typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items)
        ? (value as { items: unknown[] }).items
        : null;

  if (raw === null) return null;

  const items: FigmaSearchResultItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name : "";
    const score = typeof candidate.score === "number" ? candidate.score : Number.NaN;
    const fileKey = typeof candidate.fileKey === "string" ? candidate.fileKey : "";
    const nodeId = typeof candidate.nodeId === "string" ? candidate.nodeId : "";
    // Une entrée sans clé ni identifiant ne peut pas produire de deep-link : on l'ignore.
    if (fileKey === "" || nodeId === "") continue;
    items.push({ name, score, fileKey, nodeId });
  }
  return items;
}

/**
 * Interroge le design system via l'exécuteur injecté.
 *
 * - exécuteur qui lève → `{ status: "error", message: SEARCH_FAILURE_MESSAGE }` (panne) ;
 * - réponse reconnue, même vide → `{ status: "success", items }` (`[]` = aucun résultat) ;
 * - réponse non reconnue → `{ status: "error", message: SEARCH_UNRECOGNIZED_MESSAGE }`
 *   (ne pas confondre une évolution de format avec une absence de composant).
 *
 * Ne lève jamais.
 */
export async function searchDesignSystem(
  query: string,
  execute: FigmaSearchExecutor,
): Promise<FigmaSearchOutcome> {
  let value: unknown;
  try {
    value = await execute("search_design_system", { query });
  } catch {
    return { status: "error", message: SEARCH_FAILURE_MESSAGE };
  }

  const items = extractItems(value);
  if (items === null) {
    return { status: "error", message: SEARCH_UNRECOGNIZED_MESSAGE };
  }
  return { status: "success", items };
}
