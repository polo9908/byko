/**
 * ARCHI-7 — `lib/jira-connection.ts` et `lib/figma-connection.ts` n'exposent PAS de point
 * d'injection pour leur dépendance réseau (contrairement à `lib/ai-connection.ts` et sa
 * `TestAiConnectionOptions.fetchImpl`) : ils appellent le `fetch` global directement.
 *
 * Modifier ces fichiers pour leur ajouter une option d'injection est hors périmètre (« tu ne
 * modifies jamais `lib/` ») : le point d'injection retenu ici est `globalThis.fetch`
 * lui-même, restauré après chaque test, y compris en cas d'échec de l'assertion.
 */

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function withStubbedFetch(impl: FetchLike, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** Erreur de transport façonnée comme celle que Node/undici lève réellement (`cause.code`). */
export function networkError(code: string): Error {
  const cause = new Error(code) as Error & { code?: string };
  cause.code = code;
  const error = new Error("fetch failed") as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}
