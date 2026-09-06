/**
 * BACK-7 — validation à la frontière du corps de `POST /api/analysis`.
 *
 * Même discipline que `lib/settings-request.ts` (BACK-4) : le typage d'`AnalysisRequest`
 * (ARCHI-4) décrit la FORME attendue, il ne valide rien — un corps venant du réseau n'est
 * pas garanti par TypeScript. Ce module est la frontière : il distingue une requête bien
 * formée d'une requête malformée (qui répondra `400`), avant tout appel métier.
 */

import type { AnalysisRequest, ComparisonWindow } from "@/lib/types/analysis";

export type ParsedAnalysisRequest =
  | { ok: true; request: AnalysisRequest }
  | { ok: false; message: string };

/** Les 5 paliers, miroir runtime de l'union `ComparisonWindow` (même motif que la route scope-count). */
const COMPARISON_WINDOWS: readonly string[] = ["7d", "30d", "90d", "6m", "12m"];

function isComparisonWindow(value: unknown): value is ComparisonWindow {
  return typeof value === "string" && COMPARISON_WINDOWS.includes(value);
}

/**
 * Valide le corps de `POST /api/analysis`.
 *
 * Règles (contrat ARCHI-4, `docs/api-contracts.md` §POST /api/analysis) :
 * - `ticketSource` vaut `"jira"` ou `"manual"` ;
 * - `"jira"` exige `ticketKey` (chaîne non vide) ;
 * - `"manual"` exige `ticketText` (chaîne non vide) ;
 * - `comparisonWindow` est requis et dans les 5 paliers ;
 * - `scopeHint`, s'il est présent, est une chaîne.
 *
 * Les champs inconnus sont ignorés (tolérance habituelle de la frontière) ; seul le
 * minimum nécessaire à typer le corps sans ambiguïté est exigé.
 */
export function parseAnalysisRequest(body: unknown): ParsedAnalysisRequest {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Le corps de la requête doit être un objet JSON." };
  }
  const candidate = body as Record<string, unknown>;

  if (candidate.ticketSource !== "jira" && candidate.ticketSource !== "manual") {
    return {
      ok: false,
      message: `Le champ \`ticketSource\` doit valoir "jira" ou "manual".`,
    };
  }

  if (!isComparisonWindow(candidate.comparisonWindow)) {
    return {
      ok: false,
      message: `Le champ \`comparisonWindow\` est requis et doit être l'un des 5 paliers (${COMPARISON_WINDOWS.join(", ")}).`,
    };
  }

  const scopeHint = candidate.scopeHint;
  if (scopeHint !== undefined && typeof scopeHint !== "string") {
    return { ok: false, message: "Le champ `scopeHint` doit être une chaîne de caractères." };
  }

  const comparisonWindow = candidate.comparisonWindow;

  if (candidate.ticketSource === "jira") {
    if (typeof candidate.ticketKey !== "string" || candidate.ticketKey.trim() === "") {
      return { ok: false, message: "En mode Jira, le champ `ticketKey` est requis." };
    }
    return {
      ok: true,
      request: { ticketSource: "jira", ticketKey: candidate.ticketKey, comparisonWindow, scopeHint },
    };
  }

  if (typeof candidate.ticketText !== "string" || candidate.ticketText.trim() === "") {
    return { ok: false, message: "En mode manuel, le champ `ticketText` est requis." };
  }
  return {
    ok: true,
    request: { ticketSource: "manual", ticketText: candidate.ticketText, comparisonWindow, scopeHint },
  };
}
