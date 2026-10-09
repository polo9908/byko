/** Comptes locaux de BYKO (contrat : docs/ipc/accounts.md). */
export interface AccountSummary {
  id: string
  /** Absent tant que l'assistant de démarrage de ce compte n'a pas enregistré d'e-mail. */
  email?: string
  /** Prénom et nom, s'ils sont connus. */
  name?: string
  /** Compte actuellement connecté. */
  active: boolean
  /** Connexions déjà enregistrées pour ce compte (jamais de valeur, seulement le nom). */
  connectors: string[]
}
