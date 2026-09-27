import { app, safeStorage } from "electron"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname, join } from "path"

/**
 * Stockage chiffré des jetons/clés API (Jira, Anthropic, Figma, ...).
 *
 * Chiffrement lié à l'utilisateur du système via `safeStorage` d'Electron
 * (Keychain sur macOS, DPAPI sur Windows, kwallet/gnome-libsecret sur Linux).
 * Le fichier sur disque ne contient jamais de secret en clair, uniquement
 * du texte chiffré encodé en base64.
 *
 * Ce module ne doit être importé que depuis le main process. Aucun getter
 * générique n'est exposé au renderer : chaque intégration (voir
 * `src/main/integrations/*`) expose ses propres actions métier via IPC.
 */

type SecretStore = Record<string, string>

function secretsFilePath(): string {
  return join(app.getPath("userData"), "secrets.json")
}

async function readStore(): Promise<SecretStore> {
  try {
    const raw = await readFile(secretsFilePath(), "utf-8")
    return JSON.parse(raw) as SecretStore
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {}
    }
    throw error
  }
}

async function writeStore(store: SecretStore): Promise<void> {
  const file = secretsFilePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store), { mode: 0o600 })
}

/** À vérifier avant tout appel à `setSecret`/`getSecret` : reflète, par ex., un trousseau OS indisponible. */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (!isEncryptionAvailable()) {
    throw new Error(
      `Chiffrement indisponible sur cet appareil : impossible de stocker le secret "${key}" en toute sécurité.`,
    )
  }
  const store = await readStore()
  store[key] = safeStorage.encryptString(value).toString("base64")
  await writeStore(store)
}

/**
 * Écrit plusieurs secrets en une seule écriture de fichier : soit tous sont
 * persistés, soit aucun (utile quand des secrets n'ont de sens qu'ensemble).
 */
export async function setSecrets(entries: Record<string, string>): Promise<void> {
  if (!isEncryptionAvailable()) {
    throw new Error("Chiffrement indisponible sur cet appareil : impossible de stocker les secrets en toute sécurité.")
  }
  const store = await readStore()
  for (const [key, value] of Object.entries(entries)) {
    store[key] = safeStorage.encryptString(value).toString("base64")
  }
  await writeStore(store)
}

export async function getSecret(key: string): Promise<string | undefined> {
  const store = await readStore()
  const cipher = store[key]
  if (cipher === undefined) {
    return undefined
  }
  if (!isEncryptionAvailable()) {
    throw new Error(`Chiffrement indisponible sur cet appareil : impossible de lire le secret "${key}".`)
  }
  return safeStorage.decryptString(Buffer.from(cipher, "base64"))
}

export async function hasSecret(key: string): Promise<boolean> {
  const store = await readStore()
  return key in store
}

export async function deleteSecret(key: string): Promise<void> {
  const store = await readStore()
  if (key in store) {
    delete store[key]
    await writeStore(store)
  }
}
