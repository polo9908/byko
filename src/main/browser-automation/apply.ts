import * as googleCalendar from "../integrations/google-calendar"
import type { ConnectableConnectorId } from "../../shared/connectors"

/**
 * Remet les valeurs ramassées par une recette au connecteur concerné, par la
 * fonction `connect` qui existe déjà dans son intégration.
 *
 * C'est le seul endroit qui connaisse à la fois la capture et les intégrations :
 * une recette n'appelle jamais un connecteur directement, et ce fichier ne
 * connaît aucun sélecteur. Ajouter un connecteur consiste à ajouter un cas ici —
 * sans toucher à l'exécution des recettes.
 */
export async function applyCapturedValues(
  connector: ConnectableConnectorId,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  switch (connector) {
    case "calendar":
      // `connectWithCredentials` valide déjà la forme des identifiants, pré-vérifie
      // le client auprès de Google, puis lance le flux OAuth (boucle locale + PKCE) —
      // c'est là que l'utilisateur clique « Autoriser ».
      await googleCalendar.connectWithCredentials(
        requireValue(values, "calendar.clientId"),
        requireValue(values, "calendar.clientSecret"),
      )
      return
    default:
      throw new Error(`Aucune chaîne de capture n'est branchée pour le connecteur « ${connector} ».`)
  }
}

function requireValue(values: Readonly<Record<string, string>>, key: string): string {
  const value = values[key]
  if (typeof value !== "string" || value === "") {
    throw new Error(`La capture « ${key} » est manquante.`)
  }
  return value
}
