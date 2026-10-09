import { app } from "electron"
import electronUpdater from "electron-updater"

/**
 * Mise à jour automatique (contrat : docs/release.md). Uniquement sur l'app installée ; la source est fixée au build
 * (`publish` de electron-builder.yml → releases GitHub du dépôt), jamais par le renderer ni par un réglage.
 * La mise à jour est téléchargée en arrière-plan et installée à la fermeture : rien n'interrompt l'utilisateur.
 * electron-updater vérifie la signature du paquet reçu sur macOS, et sur Windows seulement si l'installeur est signé
 * (sinon seule l'empreinte publiée dans la même release fait foi — voir docs/release.md).
 */
const FIRST_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60_000

export function startAutoUpdate(): void {
  if (!app.isPackaged) return
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  // Le journal par défaut d'electron-updater écrit la pile complète (adresses, chemins du cache) : il est coupé.
  autoUpdater.logger = null
  // Un échec (hors ligne, app non signée, release absente) ne doit jamais gêner l'usage : nom de l'erreur seulement.
  autoUpdater.on("error", (error: unknown) => {
    console.warn(`[updater] vérification impossible (${error instanceof Error ? error.name : "erreur inconnue"}).`)
  })
  autoUpdater.on("update-downloaded", (info) => {
    console.info(`[updater] version ${info.version} téléchargée ; installation à la fermeture.`)
  })
  const check = (): void => {
    // L'échec est déjà tracé par l'événement « error ».
    autoUpdater.checkForUpdates().catch(() => undefined)
  }
  setTimeout(check, FIRST_CHECK_DELAY_MS)
  setInterval(check, CHECK_INTERVAL_MS)
}
