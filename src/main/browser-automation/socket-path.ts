import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Chemin du point de rendez-vous local entre le processus main et le helper
 * natif.
 *
 * Calculé ici et nulle part ailleurs : le helper est lancé par Chrome, sans
 * argument ni variable d'environnement que BYKO contrôlerait, donc sans accès à
 * `app.getPath("userData")`. Les deux processus doivent tomber sur le même
 * chemin — d'où cette source unique.
 */
export function browserAutomationSocketPath(): string {
  // Permet de faire pointer le pont ailleurs (test isolé, instance parallèle)
  // sans toucher au code. La valeur vient du lanceur ou d'un test, jamais du
  // renderer ni d'une page.
  const override = process.env["BYKO_BROWSER_AUTOMATION_SOCKET"]
  if (typeof override === "string" && override.trim() !== "") return override

  if (process.platform === "win32") {
    // Un tube nommé, là où un socket Unix n'existe pas.
    return "\\\\.\\pipe\\byko-browser-automation"
  }
  return join(appDataDirectory(), "BYKO", "browser-automation.sock")
}

/** Répertoire de données applicatives de la plateforme, comme `app.getPath("appData")`. */
export function appDataDirectory(): string {
  if (process.platform === "win32") {
    return process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming")
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support")
  }
  return process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config")
}
