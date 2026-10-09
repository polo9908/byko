/** Profil local de l'utilisateur (contrat : docs/ipc/profile.md). */
export interface ProfileState {
  /** Identifiant du compte actif ; sert à rattacher les données du renderer (mémos, comptes rendus) à ce compte. */
  accountId?: string
  /** Ce compte est celui qui a hérité des données d'avant les comptes (mémos et comptes rendus du renderer). */
  ownsLegacyData?: boolean
  /** E-mail saisi à la première configuration ; absent tant qu'il n'a pas été saisi (ou si le stockage chiffré est indisponible). */
  email?: string
  /** Prénom et nom (profil Jira) ; absent tant qu'ils ne sont pas connus : l'interface en déduit un nom de l'e-mail. */
  name?: string
  /** Rôle choisi à la configuration, modifiable dans Réglages > Comptes ; absent sur une installation antérieure à ce choix. */
  role?: ProfileRole
  /** Faux tant que l'assistant de démarrage n'a pas été terminé : à vrai, BYKO s'ouvre directement sur la vue journée. */
  onboarded: boolean
  /** Faux après une déconnexion : l'app propose alors le choix du compte au lieu de la vue journée. */
  signedIn: boolean
}

export const PROFILE_EMAIL_MAX = 254

export type ProfileRole = "product" | "dev" | "design" | "architect" | "qa" | "manager"

/** Liste blanche des rôles : le renderer n'envoie qu'un de ces identifiants, main le vérifie. */
export const PROFILE_ROLES: { id: ProfileRole; label: string }[] = [
  { id: "product", label: "PO / PM" },
  { id: "dev", label: "Développement" },
  { id: "design", label: "Design" },
  { id: "architect", label: "Architecture" },
  { id: "qa", label: "QA" },
  { id: "manager", label: "Management" },
]

export function isProfileRole(value: unknown): value is ProfileRole {
  return PROFILE_ROLES.some((role) => role.id === value)
}

/** « camille.durand42@exemple.fr » → « Camille Durand » : repli quand le vrai nom n'est pas connu. */
export function displayNameFromEmail(email: string | undefined): string {
  if (!email) return ""
  const local = email.split("@")[0] ?? ""
  return local
    .split(/[._+-]+/)
    .map((part) => part.replace(/\d+/g, ""))
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}
