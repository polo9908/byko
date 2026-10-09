import { accountDataPath } from "./accountPaths"
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { randomUUID } from "crypto"
import { PRIVACY_DEFAULTS } from "../shared/privacy"
import type { PrivacySettings } from "../shared/privacy"

/**
 * Réglages de confidentialité (contrat : docs/ipc/assistant-context-privacy.md).
 * Une préférence, pas un secret : JSON en clair dans `userData/privacy.json`.
 *
 * Lecture fail-closed : un fichier présent mais illisible ou invalide vaut
 * « désactivé », on ne partage pas une donnée dont on ne peut pas prouver le
 * consentement. Aucun message produit ici ne cite le contenu ni le chemin du fichier.
 */

const FILE_NAME = "privacy.json"
const FAIL_CLOSED: PrivacySettings = { shareRecentActivityWithAi: false, aiEnabled: false }

function privacyFilePath(): string {
  return accountDataPath(FILE_NAME)
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === "string" ? code : "inconnu"
}

// Le réglage est relu à chaque frappe de `assistant:suggest` : un même défaut n'est signalé qu'une fois, jusqu'à la prochaine lecture saine.
let lastWarning: string | null = null

function warnOnce(message: string): void {
  if (lastWarning === message) return
  lastWarning = message
  console.warn(`[privacy] ${message}`)
}

async function readSettings(): Promise<PrivacySettings> {
  let raw: string
  try {
    raw = await readFile(privacyFilePath(), "utf-8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      lastWarning = null
      return { ...PRIVACY_DEFAULTS }
    }
    warnOnce(`réglage illisible (code ${errorCode(error)}) ; partage et IA désactivés.`)
    return { ...FAIL_CLOSED }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    warnOnce("réglage invalide (JSON mal formé) ; partage et IA désactivés.")
    return { ...FAIL_CLOSED }
  }
  const record =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const share = record.shareRecentActivityWithAi
  if (typeof share !== "boolean") {
    warnOnce("réglage invalide (shareRecentActivityWithAi non booléen) ; partage et IA désactivés.")
    return { ...FAIL_CLOSED }
  }
  // Absent : fichier écrit avant l'ajout de l'interrupteur, on garde le défaut. Présent mais non booléen : fail-closed.
  const aiEnabled = record.aiEnabled
  if (aiEnabled !== undefined && typeof aiEnabled !== "boolean") {
    warnOnce("réglage invalide (aiEnabled non booléen) ; partage et IA désactivés.")
    return { ...FAIL_CLOSED }
  }
  lastWarning = null
  return { shareRecentActivityWithAi: share, aiEnabled: aiEnabled ?? PRIVACY_DEFAULTS.aiEnabled }
}

/** Fichier temporaire dans le même dossier puis `rename` : un arrêt en pleine écriture ne laisse jamais un JSON tronqué. */
async function writeSettings(settings: PrivacySettings): Promise<void> {
  const file = privacyFilePath()
  const dir = dirname(file)
  const tmp = join(dir, `${FILE_NAME}.${randomUUID()}.tmp`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify(settings))
    await rename(tmp, file)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw new Error(
      `Enregistrement du réglage de confidentialité impossible (code ${errorCode(error)}).`,
    )
  }
}

let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/** Relu à chaque appel, sans cache : un changement de réglage s'applique à la requête suivante. */
export function getSettings(): Promise<PrivacySettings> {
  return serialized(readSettings)
}

/** `enabled` est supposé déjà validé (booléen strict) par l'appelant IPC. Renvoie l'état relu après écriture. */
export function setShareRecentActivity(enabled: boolean): Promise<PrivacySettings> {
  return serialized(async () => {
    const current = await readSettings()
    await writeSettings({ ...current, shareRecentActivityWithAi: enabled })
    return readSettings()
  })
}

/** `enabled` est supposé déjà validé (booléen strict) par l'appelant IPC. Renvoie l'état relu après écriture. */
export function setAiEnabled(enabled: boolean): Promise<PrivacySettings> {
  return serialized(async () => {
    const current = await readSettings()
    await writeSettings({ ...current, aiEnabled: enabled })
    return readSettings()
  })
}
