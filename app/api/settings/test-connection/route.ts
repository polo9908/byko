/**
 * BACK-1/2/3 — branchement HTTP de `POST /api/settings/test-connection`.
 *
 * Fichier volontairement mince, comme `app/api/settings/route.ts` : seule la frontière
 * HTTP (lecture du corps, codes de statut, sérialisation JSON). Le test lui-même et la
 * validation du corps vivent dans `lib/jira-connection.ts`, `lib/figma-connection.ts` et
 * `lib/ai-connection.ts` — chacun garantit de ne jamais lever et répond la variante
 * d'erreur du contrat pour un corps incomplet ou mal formé (cf. l'en-tête de ces modules).
 *
 * Le typage des paramètres reçus par ces fonctions est un contrat d'ENTRÉE, pas une
 * validation : un corps arrivant du réseau n'est pas garanti par TypeScript. On passe donc
 * `credentials` tel que reçu (objet ou non) ; chaque fonction le contrôle à l'exécution
 * avant tout usage et avant tout appel réseau. La seule responsabilité de cette route est
 * de discriminer le bloc et d'ignorer tout champ inconnu du corps.
 *
 * Convention de codes HTTP (`docs/api-contracts.md`) : un `status: "error"` du contrat
 * répond en `200` — le front lit le corps, pas `res.ok`. Seules les requêtes que le JSON
 * ne permet pas de typer (corps illisible, bloc inconnu) répondent en `400`.
 */

import { NextResponse } from "next/server";

import { testAiConnection } from "@/lib/ai-connection";
import { testFigmaConnection } from "@/lib/figma-connection";
import { testJiraConnection } from "@/lib/jira-connection";
import type {
  AiCredentials,
  FigmaCredentials,
  JiraCredentials,
} from "@/lib/types/settings";

const BLOCK_MISSING_MESSAGE =
  "Le corps de la requête doit cibler un bloc « jira », « figma » ou « ai ».";

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Le corps de la requête n'est pas un JSON valide." },
      { status: 400 },
    );
  }

  if (typeof rawBody !== "object" || rawBody === null) {
    return NextResponse.json({ message: BLOCK_MISSING_MESSAGE }, { status: 400 });
  }

  const body = rawBody as { block?: unknown; credentials?: unknown };
  const credentials = body.credentials;

  switch (body.block) {
    case "jira":
      return NextResponse.json(await testJiraConnection(credentials as JiraCredentials));
    case "figma":
      return NextResponse.json(await testFigmaConnection(credentials as FigmaCredentials));
    case "ai":
      return NextResponse.json(await testAiConnection(credentials as AiCredentials));
    default:
      return NextResponse.json({ message: BLOCK_MISSING_MESSAGE }, { status: 400 });
  }
}
