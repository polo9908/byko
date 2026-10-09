import { app, shell } from "electron"
import { FEEDBACK_MAX_CHARS } from "../shared/feedback"

/**
 * Retour utilisateur (contrat : docs/ipc/feedback.md). Byko n'a pas de serveur : le retour s'ouvre, prérempli, dans le
 * navigateur de l'utilisateur, qui le relit et le valide lui-même. L'adresse est fixée ici, jamais fournie par le renderer.
 */
const FEEDBACK_URL = "https://github.com/polo9908/byko/issues/new"
const TITLE_MAX = 70
/** Au-delà, GitHub refuse l'adresse (« URI Too Long ») : les accents et les émojis comptent plusieurs octets une fois encodés. */
const URL_MAX = 6000

export function assertMessage(value: unknown): string {
  if (typeof value !== "string") throw new Error(`Paramètre "message" invalide : du texte est attendu.`)
  const message = value.trim()
  if (message.length === 0 || message.length > FEEDBACK_MAX_CHARS) {
    throw new Error(`Retour invalide : 1 à ${FEEDBACK_MAX_CHARS} caractères attendus.`)
  }
  return message
}

/** Seuls le texte saisi, la version de l'app et le système sont joints : ni compte, ni e-mail, ni contenu de l'app. */
export async function send(message: string): Promise<void> {
  const firstLine = Array.from(message.split("\n")[0].trim())
  const url = new URL(FEEDBACK_URL)
  url.searchParams.set("title", `Retour : ${firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX).join("")}…` : firstLine.join("")}`)
  url.searchParams.set("body", `${message}\n\n---\nByko ${app.getVersion()} · ${process.platform} ${process.arch}`)
  if (url.toString().length > URL_MAX) {
    throw new Error("Retour trop long pour être prérempli dans le navigateur : raccourcissez-le un peu.")
  }
  await shell.openExternal(url.toString())
}
