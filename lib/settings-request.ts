/**
 * BACK-4 — Validation à la frontière de `POST /api/settings`.
 *
 * `lib/types/settings.ts` documente en tête que ses types n'engagent que la compilation :
 * « un corps de requête arrivant du réseau n'est pas validé par le typage » (§Jetons,
 * §divergence n°6 de `docs/api-contracts.md`). Ce module fait ce contrôle, pour le seul
 * endpoint dont BACK-4 a la charge.
 *
 * Un refus ici correspond à un `4xx` (requête malformée) — jamais à l'enveloppe
 * `status: "error"`, réservée aux verdicts applicatifs (§« Convention de codes HTTP »).
 */

import type {
  AiCredentials,
  FigmaCredentials,
  JiraCredentials,
  ProviderId,
  SaveSettingsRequest,
} from "@/lib/types/settings";

export type ParsedSaveSettingsRequest =
  | { readonly ok: true; readonly value: SaveSettingsRequest }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

const PROVIDER_IDS: readonly ProviderId[] = [
  "anthropic",
  "openai",
  "deepseek",
  "kimi",
  "grok",
  "gemini",
];

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

function readJiraCredentials(value: unknown): JiraCredentials | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.instanceUrl) ||
    !isNonEmptyString(value.email) ||
    !isNonEmptyString(value.apiToken)
  ) {
    return null;
  }
  return { instanceUrl: value.instanceUrl, email: value.email, apiToken: value.apiToken };
}

function readFigmaCredentials(value: unknown): FigmaCredentials | null {
  if (!isRecord(value) || !isNonEmptyString(value.apiToken)) {
    return null;
  }
  return { apiToken: value.apiToken };
}

function readAiCredentials(value: unknown): AiCredentials | null {
  if (!isRecord(value) || !isProviderId(value.provider) || !isNonEmptyString(value.apiToken)) {
    return null;
  }
  return { provider: value.provider, apiToken: value.apiToken };
}

/**
 * Valide un corps de requête `POST /api/settings` déjà désérialisé (`await request.json()`).
 * Ne lève jamais : toute forme inattendue rend `{ ok: false, message }`.
 */
export function parseSaveSettingsRequest(body: unknown): ParsedSaveSettingsRequest {
  if (!isRecord(body)) {
    return { ok: false, message: "Le corps de la requête doit être un objet JSON." };
  }

  const block = body.block;
  if (block !== "jira" && block !== "figma" && block !== "ai") {
    return {
      ok: false,
      message: 'Le champ "block" doit valoir "jira", "figma" ou "ai".',
    };
  }

  if (block === "jira") {
    const credentials = readJiraCredentials(body.credentials);
    if (credentials === null) {
      return {
        ok: false,
        message:
          'Le bloc Jira attend "credentials" avec instanceUrl, email et apiToken (chaînes non vides).',
      };
    }
    return { ok: true, value: { block: "jira", credentials } };
  }

  if (block === "ai") {
    const credentials = readAiCredentials(body.credentials);
    if (credentials === null) {
      return {
        ok: false,
        message:
          'Le bloc Modèle IA attend "credentials" avec provider (un des 6 providers) et apiToken (chaîne non vide).',
      };
    }
    return { ok: true, value: { block: "ai", credentials } };
  }

  // block === "figma" : soit des credentials, soit l'action explicite "Passer cette étape".
  if (body.skipped === true) {
    return { ok: true, value: { block: "figma", skipped: true } };
  }
  const credentials = readFigmaCredentials(body.credentials);
  if (credentials === null) {
    return {
      ok: false,
      message:
        'Le bloc Figma attend soit "credentials" avec apiToken (chaîne non vide), soit { skipped: true }.',
    };
  }
  return { ok: true, value: { block: "figma", credentials } };
}
