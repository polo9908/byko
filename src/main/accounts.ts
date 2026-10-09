import { app } from "electron"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import { accountDir, accountsRoot, getActiveAccountId, isAccountId, setActiveAccountId } from "./accountPaths"
import { listSecretKeysAt, readSecretAt } from "./secrets"
import type { AccountSummary } from "../shared/accounts"

/**
 * Comptes locaux (contrat : docs/ipc/accounts.md). Registre `userData/accounts.json` : uniquement des identifiants
 * aléatoires et le compte actif. Rien de personnel n'y figure : l'e-mail et les jetons vivent chiffrés dans le dossier
 * de chaque compte. Une installation d'avant les comptes est migrée telle quelle vers le premier compte.
 */

interface Registry {
  accounts: string[]
  activeId: string | null
  /** Compte qui a hérité des données d'avant les comptes (fichiers déplacés, mémos du renderer) : lui seul les retrouve. */
  legacyId?: string
}

/** Fichiers d'une installation d'avant les comptes, déplacés dans le dossier du premier compte. */
const LEGACY_FILES = [
  "secrets.json",
  "journal.json",
  "meeting-decisions.json",
  "personal-vocabulary.json",
  "privacy.json",
  "autonomy.json",
]

const PROFILE_EMAIL_KEY = "profile.email"
const PROFILE_NAME_KEY = "profile.name"

const CONNECTOR_PREFIXES: Array<[string, string]> = [
  ["jira.", "Jira"],
  ["ai.", "IA"],
  ["figma.", "Figma"],
  ["google.calendar.", "Google Agenda"],
]

let registry: Registry = { accounts: [], activeId: null }
const listeners: Array<() => void> = []

/** Appelé après chaque changement de compte actif : vide les caches qui contiennent des données de l'ancien compte. */
export function onActiveAccountChange(listener: () => void): void {
  listeners.push(listener)
}

function registryPath(): string {
  return join(app.getPath("userData"), "accounts.json")
}

async function saveRegistry(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true })
  const tmp = `${registryPath()}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(registry))
  await rename(tmp, registryPath())
}

function applyActive(): void {
  setActiveAccountId(registry.activeId)
  for (const listener of listeners) listener()
}

async function createAccountDir(): Promise<string> {
  const id = randomUUID()
  await mkdir(accountDir(id), { recursive: true })
  return id
}

/** Dossiers de comptes présents sur le disque : sert à reconstruire un registre perdu ou illisible sans rendre invisible aucun compte. */
async function accountsOnDisk(): Promise<string[]> {
  try {
    return (await readdir(accountsRoot(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isAccountId(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Déplace les fichiers d'avant les comptes dans le premier compte ; au moindre échec, tout est remis en place (rien d'orphelin). */
async function migrateLegacyFiles(id: string): Promise<void> {
  const moved: Array<[string, string]> = []
  try {
    for (const name of LEGACY_FILES) {
      const from = join(app.getPath("userData"), name)
      if (!existsSync(from)) continue
      const to = join(accountDir(id), name)
      await rename(from, to)
      moved.push([from, to])
    }
  } catch (error) {
    for (const [from, to] of moved.reverse()) await rename(to, from).catch(() => undefined)
    await rm(accountDir(id), { recursive: true, force: true }).catch(() => undefined)
    throw new Error(`Migration des données impossible (code ${(error as NodeJS.ErrnoException).code ?? "inconnu"}) ; rien n'a été modifié.`)
  }
}

/** À appeler avant d'ouvrir la fenêtre : lit le registre, migre l'ancienne installation, active le dernier compte. */
export async function initAccounts(): Promise<void> {
  let loaded: Registry | null = null
  try {
    const parsed = JSON.parse(await readFile(registryPath(), "utf-8")) as Partial<Registry>
    if (Array.isArray(parsed.accounts)) {
      const accounts = parsed.accounts.filter((id): id is string => isAccountId(id) && existsSync(accountDir(id)))
      const activeId = isAccountId(parsed.activeId) && accounts.includes(parsed.activeId) ? parsed.activeId : null
      const legacyId = isAccountId(parsed.legacyId) && accounts.includes(parsed.legacyId) ? parsed.legacyId : undefined
      loaded = { accounts, activeId, ...(legacyId ? { legacyId } : {}) }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[accounts] registre illisible (${error instanceof Error ? error.name : "inconnu"}) ; reconstruction.`)
    }
  }

  if (loaded) {
    registry = loaded
  } else {
    const onDisk = await accountsOnDisk()
    if (onDisk.length > 0) {
      // Registre perdu ou corrompu : les comptes existent encore, on les retrouve. Un seul → connexion auto ; plusieurs → choix.
      registry = { accounts: onDisk, activeId: onDisk.length === 1 ? onDisk[0] : null }
    } else {
      // Première fois avec les comptes : ce qui existe déjà (jetons, journal…) devient le premier compte, sans rien perdre.
      const id = await createAccountDir()
      await migrateLegacyFiles(id)
      registry = { accounts: [id], activeId: id, legacyId: id }
    }
    await saveRegistry()
  }
  applyActive()
}

export function isLegacyOwner(id: string | null): boolean {
  return id !== null && registry.legacyId === id
}

async function emailOf(id: string): Promise<string | undefined> {
  try {
    return (await readSecretAt(id, PROFILE_EMAIL_KEY)) || undefined
  } catch {
    return undefined
  }
}

async function nameOf(id: string): Promise<string | undefined> {
  try {
    return (await readSecretAt(id, PROFILE_NAME_KEY)) || undefined
  } catch {
    return undefined
  }
}

async function connectorsOf(id: string): Promise<string[]> {
  try {
    const keys = await listSecretKeysAt(id)
    return CONNECTOR_PREFIXES.filter(([prefix]) => keys.some((key) => key.startsWith(prefix))).map(([, label]) => label)
  } catch {
    return []
  }
}

export async function listAccounts(): Promise<AccountSummary[]> {
  const rows = await Promise.all(
    registry.accounts.map(async (id) => ({
      id,
      email: await emailOf(id),
      name: await nameOf(id),
      active: id === registry.activeId,
      connectors: await connectorsOf(id),
    })),
  )
  return rows.map(({ email, name, ...row }) => ({ ...row, ...(email ? { email } : {}), ...(name ? { name } : {}) }))
}

/**
 * Un compte jamais configuré (aucun secret, aucun autre fichier), laissé par un « Ajouter un compte » abandonné, n'a pas à
 * encombrer la liste. Un compte dont on n'arrive pas à lire le contenu n'est JAMAIS supprimé : on ne détruit pas ce qu'on ne voit pas.
 */
async function isProvablyEmpty(id: string): Promise<boolean> {
  try {
    const entries = (await readdir(accountDir(id))).filter((name) => name !== "secrets.json")
    return entries.length === 0 && (await listSecretKeysAt(id)).length === 0
  } catch {
    return false
  }
}

async function pruneEmpty(keepId: string | null): Promise<void> {
  for (const id of [...registry.accounts]) {
    if (id !== keepId && (await isProvablyEmpty(id))) await dropAccount(id)
  }
}

async function dropAccount(id: string): Promise<void> {
  registry.accounts = registry.accounts.filter((existing) => existing !== id)
  if (registry.activeId === id) registry.activeId = null
  if (registry.legacyId === id) delete registry.legacyId
  await rm(accountDir(id), { recursive: true, force: true })
}

export function assertKnownAccount(value: unknown): string {
  if (!isAccountId(value) || !registry.accounts.includes(value)) throw new Error("Compte inconnu.")
  return value
}

/** Connexion rapide : le compte devient l'actif, avec tous ses jetons et ses données. */
export async function switchAccount(id: string): Promise<void> {
  registry.activeId = id
  await pruneEmpty(id)
  await saveRegistry()
  applyActive()
}

/** Nouveau compte vide, activé aussitôt : l'assistant de démarrage s'ouvre. Les autres comptes ne sont pas touchés. */
export async function addAccount(): Promise<void> {
  const id = await createAccountDir()
  registry.accounts.push(id)
  registry.activeId = id
  await pruneEmpty(id)
  await saveRegistry()
  applyActive()
}

/** Déconnexion : plus aucun compte actif, mais rien n'est effacé — se reconnecter se fait en un clic. */
export async function logout(): Promise<void> {
  registry.activeId = null
  await pruneEmpty(null)
  await saveRegistry()
  applyActive()
}

/** Oublier un compte : ses jetons chiffrés et ses données locales sont supprimés. */
export async function removeAccount(id: string): Promise<void> {
  const wasActive = getActiveAccountId() === id
  await dropAccount(id)
  await saveRegistry()
  if (wasActive) applyActive()
}
