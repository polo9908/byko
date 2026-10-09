import { useEffect, useState } from "react"
import type { AccountSummary } from "@shared/accounts"
import { displayNameFromEmail } from "@shared/profile"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import OnboardingHeader from "./OnboardingHeader"
import "./onboarding.css"

/** Après une déconnexion : choisir le compte à ouvrir (connexion rapide, un clic) ou en ajouter un. */
function AccountsScreen(): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.accounts
      .list()
      .then(setAccounts)
      .catch((err: unknown) => setError(cleanIpcErrorMessage(err)))
  }, [])

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="onboarding-screen">
      <section className="onboarding-step">
        <OnboardingHeader stepIndex={0} totalSteps={5} timeLabel="Comptes" />

        <h1 className="onboarding-title">Choisir un compte.</h1>
        <p className="onboarding-subtitle">Ouvrez un compte déjà configuré en un clic, ou ajoutez-en un autre.</p>

        <div className="onboarding-card onboarding-accounts">
          {accounts === null && !error && <p>Lecture des comptes…</p>}
          {accounts?.map((account) => (
            <button
              key={account.id}
              type="button"
              className="onboarding-account"
              disabled={busy}
              onClick={() => void run(() => window.api.accounts.switchTo(account.id))}
            >
              <span className="onboarding-account-avatar" aria-hidden="true">
                {(account.name ?? displayNameFromEmail(account.email) ?? "?").slice(0, 1).toUpperCase() || "?"}
              </span>
              <span className="onboarding-account-info">
                <span className="onboarding-account-email">{account.name ?? (displayNameFromEmail(account.email) || "Compte à configurer")}</span>
                <span className="onboarding-account-meta">
                  {[account.email, account.connectors.join(" · ")].filter(Boolean).join(" — ") || "Aucune connexion enregistrée"}
                </span>
              </span>
            </button>
          ))}
        </div>
        {error && <p className="onboarding-error">{error}</p>}
        <div className="onboarding-actions">
          <span />
          <button
            type="button"
            className="onboarding-button onboarding-button--primary"
            disabled={busy}
            onClick={() => void run(() => window.api.accounts.add())}
          >
            + Ajouter un compte
          </button>
        </div>
      </section>
    </div>
  )
}

export default AccountsScreen
