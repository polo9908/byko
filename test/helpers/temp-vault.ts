/**
 * ARCHI-7 — Point d'injection commun aux tests de `lib/token-storage.ts`.
 *
 * `VaultLocation` est le point d'injection PRÉVU par le module (voir son commentaire
 * « c'est le point d'injection des tests ») : chaque test obtient un répertoire temporaire
 * dédié, jamais `~/.bcc`, et le répertoire est supprimé même si le test échoue.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { VaultLocation } from "@/lib/token-storage";

/**
 * Crée un répertoire temporaire, construit le `VaultLocation` qui y pointe, exécute `run`,
 * puis nettoie — y compris si `run` lève ou si l'assertion échoue.
 */
export async function withTempVault<T>(
  run: (location: VaultLocation) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "bcc-vault-test-"));
  const location: VaultLocation = {
    directory,
    configPath: join(directory, "config.enc"),
    keyPath: join(directory, "master.key"),
  };
  try {
    return await run(location);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
