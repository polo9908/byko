#!/usr/bin/env node
/**
 * Installe le manifeste hôte de messagerie native pour l'installation de Chrome
 * de l'utilisateur courant, à partir de l'extension non empaquetée de
 * `browser-extension/`.
 *
 * À relancer après `npm run build`, et après avoir déplacé le dossier du projet
 * (l'identifiant de l'extension est dérivé de son chemin absolu).
 *
 * Phase ② : macOS et Linux. Windows demanderait un exécutable natif, pas un
 * script shell — hors périmètre pour l'instant.
 */
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const NATIVE_HOST_NAME = "com.byko.browser_automation"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const extensionDir = join(root, "browser-extension")
const helperPath = join(root, "out", "main", "nativeHost.js")

function fail(message) {
  process.stderr.write(`Erreur : ${message}\n`)
  process.exit(1)
}

/**
 * Identifiant d'une extension non empaquetée : Chrome hache son chemin absolu
 * (SHA-256), garde les 16 premiers octets, et décale chaque chiffre hexa dans
 * la plage a-p.
 */
function extensionIdFor(directory) {
  const digest = createHash("sha256").update(directory).digest("hex").slice(0, 32)
  return digest.replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
}

function electronBinary() {
  const dist = join(root, "node_modules", "electron", "dist")
  if (process.platform === "darwin") return join(dist, "Electron.app", "Contents", "MacOS", "Electron")
  if (process.platform === "win32") return join(dist, "electron.exe")
  return join(dist, "electron")
}

/**
 * Répertoire de données applicatives de la plateforme. Doit rester aligné avec
 * `appDataDirectory()` (src/main/browser-automation/socket-path.ts) : le helper
 * y place aussi son socket.
 */
function appDataDirectory() {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support")
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
}

/** Répertoire des manifestes hôtes de Chrome. */
function chromeHostManifestDir() {
  if (process.platform === "darwin") {
    return join(appDataDirectory(), "Google", "Chrome", "NativeMessagingHosts")
  }
  return join(homedir(), ".config", "google-chrome", "NativeMessagingHosts")
}

if (process.platform === "win32") {
  fail("Windows n'est pas pris en charge par cette phase : le manifeste devrait pointer vers un exécutable natif.")
}
if (!existsSync(extensionDir)) fail(`dossier d'extension introuvable : ${extensionDir}`)
if (!existsSync(helperPath)) fail(`helper introuvable : ${helperPath}\nLancez d'abord « npm run build ».`)

const electron = electronBinary()
if (!existsSync(electron)) fail(`binaire Electron introuvable : ${electron}\nLancez d'abord « npm install ».`)

const extensionId = extensionIdFor(extensionDir)
const runtimeDir = join(appDataDirectory(), "BYKO", "native-host")
const launcherPath = join(runtimeDir, "launch-host.sh")
const hostManifestPath = join(chromeHostManifestDir(), `${NATIVE_HOST_NAME}.json`)

mkdirSync(runtimeDir, { recursive: true })
mkdirSync(dirname(hostManifestPath), { recursive: true })

// Chrome exige un exécutable : ce script n'est qu'un lanceur qui évite d'exiger
// un Node système à côté de l'application.
writeFileSync(
  launcherPath,
  [
    "#!/bin/sh",
    "# Généré par scripts/install-native-host.mjs — ne pas éditer à la main.",
    `ELECTRON_RUN_AS_NODE=1 exec "${electron}" "${helperPath}"`,
    "",
  ].join("\n"),
  "utf8",
)
chmodSync(launcherPath, 0o755)

writeFileSync(
  hostManifestPath,
  `${JSON.stringify(
    {
      name: NATIVE_HOST_NAME,
      description: "Pont de messagerie native entre l'extension navigateur BYKO et l'application.",
      path: launcherPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  )}\n`,
  "utf8",
)

process.stdout.write(
  [
    "Pont natif installé.",
    "",
    `  Extension      ${extensionDir}`,
    `  Identifiant    ${extensionId}`,
    `  Lanceur        ${launcherPath}`,
    `  Manifeste      ${hostManifestPath}`,
    "",
    "Étapes suivantes :",
    "  1. Ouvrir chrome://extensions, activer le mode développeur.",
    "  2. « Charger l'extension non empaquetée » et choisir le dossier ci-dessus.",
    `  3. Vérifier que l'identifiant affiché par Chrome est bien ${extensionId}.`,
    "     S'il diffère, relancer ce script : il se recale sur le chemin réel.",
    "  4. Redémarrer Chrome, puis lancer BYKO, et regarder la console de BYKO.",
    "",
  ].join("\n"),
)
