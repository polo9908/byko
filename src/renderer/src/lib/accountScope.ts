/**
 * Données du renderer rattachées au compte actif (mémos, comptes rendus de réunion) : leur clé `localStorage` porte
 * l'identifiant du compte, pour que deux comptes ne voient jamais les données l'un de l'autre.
 * L'identifiant est fixé au démarrage (App, avant d'afficher quoi que ce soit) ; la fenêtre est rechargée à chaque changement de compte.
 */

let scope = ""
let ownsLegacy = false

export function setAccountScope(accountId: string | undefined, ownsLegacyData = false): void {
  scope = accountId ?? ""
  ownsLegacy = ownsLegacyData
}

/** « Retirer » un compte : ses mémos et comptes rendus locaux partent avec lui. */
export function forgetAccountData(accountId: string): void {
  try {
    const suffix = `.${accountId}`
    for (const key of Object.keys(window.localStorage)) {
      if (key.endsWith(suffix)) window.localStorage.removeItem(key)
    }
  } catch {
    // Stockage indisponible : rien à effacer.
  }
}

/**
 * Clé du compte actif. Données d'avant les comptes (clé sans suffixe) : seul le compte migré (celui qui a hérité des fichiers
 * d'avant les comptes) les adopte, puis la clé d'origine est supprimée ; les autres comptes partent de zéro.
 */
export function scopedKey(base: string): string {
  if (!scope) return base
  const key = `${base}.${scope}`
  try {
    if (ownsLegacy && window.localStorage.getItem(key) === null) {
      const legacy = window.localStorage.getItem(base)
      if (legacy !== null) {
        window.localStorage.setItem(key, legacy)
        window.localStorage.removeItem(base)
      }
    }
  } catch {
    // Stockage indisponible : la lecture/écriture suivante échouera de la même façon et sera gérée par l'appelant.
  }
  return key
}
