import { useEffect, useState } from "react"
import type { AccountSummary } from "@shared/accounts"
import { displayNameFromEmail } from "@shared/profile"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import "./onboarding.css"

function label(account: AccountSummary): string {
  return account.name ?? (displayNameFromEmail(account.email) || "Compte à configurer")
}

/**
 * « Mes comptes » : les autres comptes de cet appareil, en lignes empilées sous la configuration (comme l'écran de connexion
 * de Messenger ou d'Instagram). Un clic ouvre le compte avec toutes ses connexions. Liste réelle ; rien si aucun autre compte.
 */
function OtherAccountsList(): React.JSX.Element | null {
  const [others, setOthers] = useState<AccountSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.accounts
      .list()
      .then((list) => {
        if (!cancelled) setOthers(list.filter((account) => !account.active))
      })
      .catch((err: unknown) => console.warn("Liste des comptes indisponible :", err))
    return () => {
      cancelled = true
    }
  }, [])

  if (others.length === 0) return null

  async function open(account: AccountSummary): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // En cas de succès, main recharge la fenêtre sur ce compte.
      await window.api.accounts.switchTo(account.id)
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <section className="onboarding-mes-comptes" aria-label="Mes comptes">
      <p className="onboarding-mes-comptes-title">Mes comptes</p>
      <div className="onboarding-mes-comptes-list">
        {others.map((account) => (
          <button
            key={account.id}
            type="button"
            className="onboarding-account"
            disabled={busy}
            onClick={() => void open(account)}
          >
            <span className="onboarding-account-avatar" aria-hidden="true">
              {label(account).slice(0, 1).toUpperCase()}
            </span>
            <span className="onboarding-account-info">
              <span className="onboarding-account-email">{label(account)}</span>
              <span className="onboarding-account-meta">
                {[account.email, account.connectors.join(" · ")].filter(Boolean).join(" — ") || "Aucune connexion enregistrée"}
              </span>
            </span>
            <span className="onboarding-account-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
      {error && <p className="onboarding-error">{error}</p>}
    </section>
  )
}

export default OtherAccountsList
