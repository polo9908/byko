/**
 * BACK-6 — `GET /api/analysis/scope-count` (`docs/api-contracts.md`, §`GET /api/analysis/scope-count`).
 *
 * Route volontairement mince, comme `app/api/settings/route.ts` (BACK-4) : frontière HTTP
 * seulement (lecture des paramètres de requête, codes de statut, sérialisation JSON). Toute
 * la logique vit dans `lib/` — `lib/jira-scope.ts` (BACK-5) pour la résolution du périmètre,
 * `lib/analysis-cost.ts` (BACK-6) pour la conversion du count en niveau. AUCUN appel IA ici,
 * ni direct ni indirect : `resolveComparisonScope` n'en déclenche pas (en-tête de
 * `lib/jira-scope.ts`), et cette route ne fait rien d'autre que l'appeler puis compter.
 *
 * ───── ARBITRAGE BACK-6 : le count est borné à SCOPE_MAX_RESULTS (200) ─────
 * `resolveComparisonScope` plafonne la recherche JQL à 200 clés (`SCOPE_MAX_RESULTS`,
 * `lib/jira-scope.ts`, en-tête §6) : au-delà, les clés sont tronquées par Jira et le module
 * ne renvoie que le corpus effectivement lu — il ne lit jamais le champ `total` de la réponse
 * de recherche. Le `count` de cette route est donc la TAILLE DU CORPUS RÉELLEMENT RENVOYÉ
 * (`ticketKeys.length`), pas un total Jira reconstitué au-delà du plafond.
 * Pourquoi ce choix : le badge du curseur (FRONT-8) annonce ce que l'analyse comparera
 * vraiment — un corpus borné à 200 tickets — et afficher « 340 tickets » alors que seuls 200
 * seront lus mentirait sur le coût réel comme sur le niveau qui en découle. Conséquence
 * assumée : si la fenêtre contient plus de 200 tickets, le badge plafonne à « 200 », qui
 * n'est plus le total exact Jira. Si le produit exige un comptage exact au-delà du plafond,
 * il faudra que le resolver expose le `total` de la recherche : décision BACK-6 à porter à
 * l'orchestrateur, pas élargie unilatéralement ici.
 *
 * Convention d'erreur (`docs/api-contracts.md`, §« Convention de codes HTTP ») :
 * - requête malformée (`comparisonWindow` absent ou hors des 5 paliers) → `400` avec un
 *   `message` français précis, AVANT tout appel au resolver — le `4xx` est réservé à ce cas ;
 * - échec applicatif rattrapé (Jira non connecté, instance injoignable…) → `200` avec la
 *   variante `{ status: "error", message }` du contrat, jamais rabattu sur un « 0 ticket » :
 *   le badge « 0 tickets · Coût faible » mentirait (décision ARCHI-4 n°3).
 *
 * Jamais mise en cache : le comptage dépend du contenu Jira et du coffre à chaque appel —
 * `export const dynamic = "force-dynamic"`, comme `GET /api/settings`.
 */

import { NextResponse } from "next/server";

import { costLevelForCount } from "@/lib/analysis-cost";
import { resolveComparisonScope } from "@/lib/jira-scope";
import type { ScopeCountResponse, ComparisonWindow } from "@/lib/types/analysis";

export const dynamic = "force-dynamic";

/**
 * Les 5 paliers de la fenêtre, miroir RUNTIME de l'union `ComparisonWindow`
 * (`lib/types/analysis.ts`). `lib/jira-scope.ts` garde la même liste en privé (elle ne
 * l'exporte pas, et ce module ne se modifie pas) : la route a besoin de la sienne pour
 * répondre `400` AVANT d'appeler le resolver, qui, lui, répondrait `error` — or une requête
 * malformée doit rester un `4xx` (contrat). Typée `readonly ComparisonWindow[]` : un palier
 * ajouté à l'union mais pas ici fait échouer la compilation (fail-closed), et un palier ici
 * absent de l'union aussi. Écart toléré : la liste vit en deux exemplaires (ici et dans le
 * resolver) — le typage commun garantit qu'ils ne peuvent pas diverger d'une valeur hors
 * contrat, seul l'oubli d'un ajout légitime est possible, et il échoue fermé (400), jamais
 * en erreur serveur.
 */
const COMPARISON_WINDOWS: readonly ComparisonWindow[] = ["7d", "30d", "90d", "6m", "12m"];

function isComparisonWindow(value: string): value is ComparisonWindow {
  return (COMPARISON_WINDOWS as readonly string[]).includes(value);
}

function badRequest(message: string): Response {
  // Corps nu `{ message }`, sans enveloppe `status` : le contrat de réponse ne vaut que pour
  // les `200` — même motif que les `400` de `POST /api/settings` (BACK-4).
  return NextResponse.json({ message }, { status: 400 });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const comparisonWindowParam = url.searchParams.get("comparisonWindow");
  if (comparisonWindowParam === null) {
    return badRequest(
      `Le paramètre de requête \`comparisonWindow\` est requis : indique l'un des 5 paliers de la fenêtre de comparaison (${COMPARISON_WINDOWS.join(", ")}).`,
    );
  }
  if (!isComparisonWindow(comparisonWindowParam)) {
    return badRequest(
      `Le paramètre de requête \`comparisonWindow\` doit être l'un des 5 paliers de la fenêtre de comparaison (${COMPARISON_WINDOWS.join(", ")}).`,
    );
  }

  // `searchParams.get` renvoie `null` pour un paramètre absent, `""` pour un paramètre présent
  // mais vide : l'absent devient `undefined`, le vide reste `""` — c'est le resolver (BACK-5)
  // qui tranche le vide (mode manuel, hint vide → `none`), pas la route.
  const ticketKey = url.searchParams.get("ticketKey") ?? undefined;
  const scopeHint = url.searchParams.get("scopeHint") ?? undefined;

  // Code de production : AUCUNE option passée au resolver (pas de `fetchImpl`, pas d'horloge).
  const resolution = await resolveComparisonScope({ ticketKey, scopeHint, comparisonWindow: comparisonWindowParam });

  if (resolution.status === "error") {
    const body: ScopeCountResponse = { status: "error", message: resolution.message };
    return NextResponse.json(body);
  }

  // Le count est le nombre de clés EFFECTIVEMENT renvoyées par le resolver — borné à 200 par
  // `SCOPE_MAX_RESULTS`, voir l'arbitrage en tête de fichier. `ticketKeys.length` est toujours
  // ≥ 0 : `costLevelForCount` reçoit donc un entier naturel.
  const count = resolution.ticketKeys.length;
  const body: ScopeCountResponse = { status: "success", count, costLevel: costLevelForCount(count) };
  return NextResponse.json(body);
}
