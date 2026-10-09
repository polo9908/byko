import { app } from "electron"
import { existsSync } from "fs"
import { AsyncLocalStorage } from "async_hooks"
import { join } from "path"

/**
 * Dossier de données du compte actif (`userData/accounts/<id>/`). Chaque compte a ses propres secrets, journal,
 * décisions, vocabulaire, réglages : changer de compte ne mélange jamais les données (contrat : docs/ipc/accounts.md).
 * Module sans dépendance, importé par `secrets.ts` et par chaque module qui écrit des données personnelles.
 */

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let activeAccountId: string | null = null

export function isAccountId(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_ID.test(value)
}

export function accountsRoot(): string {
  return join(app.getPath("userData"), "accounts")
}

/** L'identifiant est un UUID validé : jamais de séparateur de chemin possible. */
export function accountDir(id: string): string {
  if (!isAccountId(id)) throw new Error("Identifiant de compte invalide.")
  return join(accountsRoot(), id)
}

export function getActiveAccountId(): string | null {
  return activeAccountId
}

export function setActiveAccountId(id: string | null): void {
  activeAccountId = id
}

/**
 * Compte « lié » à une opération : chaque appel IPC est exécuté dans un contexte qui retient le compte actif au moment où il
 * a démarré (voir `bindAccountToIpc`). Une opération lente (connexion Jira, rafraîchissement d'un jeton…) qui se termine après un
 * changement de compte écrit donc toujours dans SON compte, jamais dans celui qui est devenu actif entre-temps.
 */
const operationAccount = new AsyncLocalStorage<{ accountId: string | null }>()

export function runWithActiveAccount<T>(run: () => T): T {
  return operationAccount.run({ accountId: activeAccountId }, run)
}

function currentAccountId(): string | null {
  const bound = operationAccount.getStore()
  return bound ? bound.accountId : activeAccountId
}

/** Faux si l'opération est liée à un compte aujourd'hui déconnecté ou supprimé. */
export function requireActiveAccount(): string {
  const id = currentAccountId()
  if (id === null) throw new Error("Aucun compte connecté.")
  return id
}

/** Chemin d'un fichier du compte de l'opération en cours ; refuse tout accès sans compte, ou si le compte a été supprimé. */
export function accountDataPath(fileName: string): string {
  const dir = accountDir(requireActiveAccount())
  // Un compte retiré pendant qu'une opération le concernait encore : ne jamais recréer son dossier.
  if (!existsSync(dir)) throw new Error("Compte introuvable (supprimé ?).")
  return join(dir, fileName)
}
