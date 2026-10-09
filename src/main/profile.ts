import { getSecret, isEncryptionAvailable, setSecret } from "./secrets"
import { getActiveAccountId } from "./accountPaths"
import { isLegacyOwner } from "./accounts"
import * as jira from "./integrations/jira"
import * as aiProvider from "./integrations/ai-provider"
import { PROFILE_EMAIL_MAX, isProfileRole } from "../shared/profile"
import type { ProfileRole, ProfileState } from "../shared/profile"

/**
 * Profil local (contrat : docs/ipc/profile.md) : l'e-mail saisi à la première configuration et le fait que
 * l'assistant de démarrage est terminé, pour ne plus rien redemander aux lancements suivants (connexion auto).
 * Stockage via `secrets.ts` (chiffré `safeStorage`) : l'adresse n'est pas un secret, mais c'est une donnée
 * personnelle et il n'y a qu'un seul magasin. Les jetons (Jira, IA, Figma, Google) y vivent déjà.
 */

const EMAIL_KEY = "profile.email"
const ONBOARDED_KEY = "profile.onboarded"
const NAME_KEY = "profile.name"
const ROLE_KEY = "profile.role"
const NAME_FETCH_TIMEOUT_MS = 1500

/**
 * Chiffrement indisponible : on ne bloque pas l'app, on se comporte comme un premier lancement (rien n'est écrit en clair).
 *
 * Connexion auto : une installation qui a déjà Jira ET un fournisseur d'IA connectés (jetons chiffrés, donc configurée
 * avant l'existence du profil, ou interrompue juste avant « Commencer ma journée ») est considérée comme configurée ;
 * l'e-mail est repris de la connexion Jira. Le profil est alors complété, une fois pour toutes.
 */
export async function getProfile(): Promise<ProfileState> {
  if (getActiveAccountId() === null) return { onboarded: false, signedIn: false }
  if (!isEncryptionAvailable()) return { accountId: getActiveAccountId() ?? undefined, ownsLegacyData: isLegacyOwner(getActiveAccountId()), onboarded: false, signedIn: true }
  try {
    const [stored, onboardedFlag, storedName, storedRole] = await Promise.all([
      readField(EMAIL_KEY),
      readField(ONBOARDED_KEY),
      readField(NAME_KEY),
      readField(ROLE_KEY),
    ])
    // Valeur relue du disque : hors liste blanche, elle est ignorée.
    const role = isProfileRole(storedRole) ? storedRole : undefined
    let name = storedName || undefined
    let email = stored || undefined
    let onboarded = onboardedFlag === "1"
    if (!onboarded || !email) {
      const [jiraStatus, aiStatus] = await Promise.all([jira.getStatus(), aiProvider.getStatus()])
      if (jiraStatus.connected && aiStatus.connected) {
        if (!email && jiraStatus.email) {
          email = jiraStatus.email
          await setSecret(EMAIL_KEY, email)
        }
        if (!onboarded) {
          onboarded = true
          await setSecret(ONBOARDED_KEY, "1")
        }
      }
    }
    // Nom inconnu mais Jira connecté : on le demande à Jira (court délai, sans bloquer le démarrage si Jira est lent).
    if (!name && onboarded) name = await fetchAndStoreName()
    return { ...(email ? { email } : {}), ...(name ? { name } : {}), ...(role ? { role } : {}), accountId: getActiveAccountId() ?? undefined, ownsLegacyData: isLegacyOwner(getActiveAccountId()), onboarded, signedIn: true }
  } catch (error) {
    // Fichier illisible ou secret indéchiffrable : même repli, sans citer de contenu ni de chemin.
    console.warn(`[profile] lecture impossible (${error instanceof Error ? error.name : "inconnu"}) ; démarrage comme une première fois.`)
    return { accountId: getActiveAccountId() ?? undefined, ownsLegacyData: isLegacyOwner(getActiveAccountId()), onboarded: false, signedIn: true }
  }
}

/**
 * Un champ du profil indéchiffrable (écrit avec une autre clé, abîmé) vaut « absent » : il sera redemandé ou repris de Jira,
 * sans renvoyer toute l'installation à l'assistant de démarrage. Un fichier illisible en entier reste une erreur.
 */
async function readField(key: string): Promise<string | undefined> {
  try {
    return await getSecret(key)
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code !== undefined) throw error
    console.warn(`[profile] champ « ${key} » illisible, ignoré.`)
    return undefined
  }
}

async function fetchAndStoreName(): Promise<string | undefined> {
  try {
    const found = await Promise.race([
      jira.fetchDisplayName(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), NAME_FETCH_TIMEOUT_MS)),
    ])
    if (found) await setSecret(NAME_KEY, found)
    return found
  } catch {
    return undefined
  }
}

/** Nom reçu de Jira à la connexion (déjà vérifié par Jira) ; mémorisé pour l'afficher sans réseau. */
export async function saveName(name: string): Promise<void> {
  if (!isEncryptionAvailable() || name.trim() === "") return
  await setSecret(NAME_KEY, name.trim().slice(0, 100))
}

export async function saveEmail(email: string): Promise<void> {
  if (!isEncryptionAvailable()) return
  await setSecret(EMAIL_KEY, email)
}

/** Lecture seule du rôle, sans le reste du profil ; `undefined` s'il n'est pas choisi ou pas lisible. */
export async function getRole(): Promise<ProfileRole | undefined> {
  if (getActiveAccountId() === null || !isEncryptionAvailable()) return undefined
  try {
    const stored = await getSecret(ROLE_KEY)
    return isProfileRole(stored) ? stored : undefined
  } catch {
    return undefined
  }
}

/** Contrairement à l'e-mail, un rôle non enregistré est signalé : dans les Réglages, le choix ne doit pas paraître retenu à tort. */
export async function saveRole(role: ProfileRole): Promise<void> {
  if (!isEncryptionAvailable()) throw new Error("Rôle non enregistré : le stockage chiffré est indisponible sur cet appareil.")
  await setSecret(ROLE_KEY, role)
}

export async function completeOnboarding(): Promise<void> {
  if (!isEncryptionAvailable()) return
  await setSecret(ONBOARDED_KEY, "1")
}

export function assertRole(value: unknown): ProfileRole {
  if (!isProfileRole(value)) throw new Error(`Paramètre "role" invalide : un rôle de la liste est attendu.`)
  return value
}

/** `unknown` → e-mail plausible et borné ; rien n'est écrit sinon. */
export function assertEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error(`Paramètre "email" invalide : une chaîne est attendue.`)
  const email = value.trim()
  if (email.length === 0 || email.length > PROFILE_EMAIL_MAX || !email.includes("@")) {
    throw new Error(`Paramètre "email" invalide : une adresse e-mail est attendue.`)
  }
  return email
}
