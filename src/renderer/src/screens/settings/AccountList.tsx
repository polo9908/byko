import { useEffect, useRef, useState } from "react"
import type { AccountSummary } from "@shared/accounts"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { forgetAccountData } from "../../lib/accountScope"

interface AccountListProps {
  /** Affiche aussi « Ajouter un compte » et « Se déconnecter » (Réglages) ; le sélecteur de démarrage les gère lui-même. */
  showSignOut?: boolean
}

/**
 * Liste des comptes enregistrés sur cet appareil (contrat : docs/ipc/accounts.md). Un clic sur un compte l'active avec
 * tous ses jetons et ses données (connexion rapide) ; main recharge ensuite la fenêtre.
 */
function AccountList({ showSignOut = false }: AccountListProps): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.api.accounts
      .list()
      .then((list) => {
        if (mountedRef.current) setAccounts(list)
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setError(cleanIpcErrorMessage(err))
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // En cas de succès, main recharge la fenêtre : rien d'autre à faire ici.
      await action()
    } catch (err) {
      if (mountedRef.current) {
        setError(cleanIpcErrorMessage(err))
        setBusy(false)
      }
    }
  }

  return (
    <>
      <p className="settings-section-label">Comptes sur cet appareil</p>
      {accounts === null && !error && <p className="settings-detail-hint settings-account-hint">Lecture des comptes…</p>}
      {accounts?.map((account) => (
        <div className="settings-row settings-account-row" key={account.id}>
          <div className="settings-account-avatar" aria-hidden="true">
            {(account.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="settings-row-info">
            <span className="settings-row-name">
              {account.email ?? "Compte à configurer"}
              {account.active && <span className="settings-account-badge">Actif</span>}
            </span>
            <span className="settings-row-subtitle">
              {account.connectors.length > 0 ? account.connectors.join(" · ") : "Aucune connexion enregistrée"}
            </span>
          </div>
          {!account.active && (
            <div className="settings-row-actions">
              {confirmRemoveId === account.id ? (
                <>
                  <span className="settings-detail-hint">Supprimer ses jetons et ses données ?</span>
                  <button
                    type="button"
                    className="settings-connect-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await window.api.accounts.remove(account.id)
                        forgetAccountData(account.id)
                      })
                    }
                  >
                    Supprimer
                  </button>
                  <button type="button" className="settings-guide-toggle" onClick={() => setConfirmRemoveId(null)}>
                    Annuler
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="settings-connect-button"
                    disabled={busy}
                    onClick={() => void run(() => window.api.accounts.switchTo(account.id))}
                  >
                    Se connecter
                  </button>
                  <button type="button" className="settings-guide-toggle" onClick={() => setConfirmRemoveId(account.id)}>
                    Retirer
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="settings-row settings-account-actions">
        <button
          type="button"
          className="settings-connect-button"
          disabled={busy}
          onClick={() => void run(() => window.api.accounts.add())}
        >
          + Ajouter un compte
        </button>
        {showSignOut && (
          <button
            type="button"
            className="settings-connect-button"
            disabled={busy}
            onClick={() => void run(() => window.api.accounts.logout())}
          >
            Se déconnecter
          </button>
        )}
      </div>
      {showSignOut && (
        <p className="settings-detail-hint settings-account-hint">
          Se déconnecter ne supprime rien : les jetons restent chiffrés sur cet appareil, et « Se connecter » rouvre le compte
          en un clic. Chaque compte a ses propres connexions, son journal et ses réglages.
        </p>
      )}
      {error && (
        <p className="settings-detail-error settings-account-hint" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

export default AccountList
