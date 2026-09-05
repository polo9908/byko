/**
 * BACK-4 — `GET /api/settings` et `POST /api/settings` (`docs/api-contracts.md`).
 *
 * Ce fichier est volontairement mince : il ne fait que la frontière HTTP (lecture du corps,
 * codes de statut, sérialisation JSON). Toute la logique métier vit dans des modules de
 * `lib/`, testables sans serveur HTTP : `lib/settings-request.ts` (validation d'entrée),
 * `lib/settings-service.ts` (test de connexion + persistance), `lib/settings-store.ts`
 * (schéma persisté) et `lib/settings-mapper.ts` (forme exposée).
 *
 * Jamais mis en cache : la configuration change à chaque sauvegarde et ne doit jamais servir
 * une réponse obsolète à un rechargement de page.
 */

import { NextResponse } from "next/server";

import { emptySettingsState, toSettingsState } from "@/lib/settings-mapper";
import { parseSaveSettingsRequest } from "@/lib/settings-request";
import { applySaveSettingsRequest } from "@/lib/settings-service";
import { getSettingsStore } from "@/lib/settings-store";
import type { GetSettingsResponse, SaveSettingsResponse } from "@/lib/types/settings";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const store = getSettingsStore();
  const result = await store.read();

  if (result.status === "absent") {
    const body: GetSettingsResponse = { status: "success", settings: emptySettingsState() };
    return NextResponse.json(body);
  }

  if (result.status === "error") {
    // Échec de lecture RATTRAPÉ : `200` avec la variante d'erreur du contrat
    // (`docs/api-contracts.md`, §« Convention de codes HTTP »), jamais rabattu sur « aucune
    // configuration ».
    const body: GetSettingsResponse = { status: "error", message: result.message };
    return NextResponse.json(body);
  }

  const body: GetSettingsResponse = {
    status: "success",
    settings: toSettingsState(result.value),
  };
  return NextResponse.json(body);
}

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

  const parsed = parseSaveSettingsRequest(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  // `getSettingsStore()` et non un magasin par requête : deux sauvegardes en vol simultanément
  // doivent partager la file d'écriture du coffre, sans quoi la perdante répond `success` sans
  // avoir été écrite (`lib/settings-store.ts`, §Magasins partagés).
  const store = getSettingsStore();
  const body: SaveSettingsResponse = await applySaveSettingsRequest(parsed.value, store);
  return NextResponse.json(body);
}
