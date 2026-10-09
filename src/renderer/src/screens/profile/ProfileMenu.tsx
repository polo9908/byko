import { useEffect, useRef, useState } from "react"
import { displayNameFromEmail } from "@shared/profile"
import type { AccountSummary } from "@shared/accounts"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import { GearIcon } from "../dayview/icons"
import "./profilemenu.css"

function accountName(account: AccountSummary): string {
  return account.name ?? (displayNameFromEmail(account.email) || "Nouveau compte")
}

function initialOf(account: AccountSummary): string {
  return accountName(account).slice(0, 1).toUpperCase()
}

/**
 * Encart de profil en haut à droite : prénom, nom et e-mail du compte actif. Il se déplie pour passer à un autre compte
 * (connexion rapide, un clic), en ajouter un ou se déconnecter (contrat : docs/ipc/accounts.md). Changer de compte recharge la fenêtre.
 */
interface ProfileMenuProps {
  /** Ouvre les Réglages : l'accès aux réglages vit dans ce menu, plus dans un bouton à part. */
  onOpenSettings: () => void
}

function ProfileMenu({ onOpenSettings }: ProfileMenuProps): React.JSX.Element | null {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api.accounts
      .list()
      .then((list) => {
        if (!cancelled) setAccounts(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Fermeture : clic à l'extérieur ou Échap (le focus revient sur l'encart).
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const active = accounts?.find((account) => account.active)
  if (!active) return null

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // En cas de succès, main recharge la fenêtre : rien d'autre à faire ici.
      await action()
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setBusy(false)
    }
  }

  const others = accounts?.filter((account) => !account.active) ?? []

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          playSfx("tick")
          setOpen(!open)
        }}
      >
        <span className="profile-avatar" aria-hidden="true">
          {initialOf(active)}
        </span>
        <span className="profile-identity">
          <span className="profile-name">{accountName(active)}</span>
          {active.email && <span className="profile-email">{active.email}</span>}
        </span>
        <span className={"profile-chevron" + (open ? " profile-chevron--open" : "")} aria-hidden="true">
          ›
        </span>
      </button>

      {open && (
        <div className="profile-panel" role="menu" aria-label="Comptes">
          <p className="profile-panel-label">Compte actif</p>
          <div className="profile-account profile-account--active" role="menuitem" aria-current="true" tabIndex={-1}>
            <span className="profile-avatar" aria-hidden="true">
              {initialOf(active)}
            </span>
            <span className="profile-identity">
              <span className="profile-name">{accountName(active)}</span>
              {active.email && <span className="profile-email">{active.email}</span>}
              <span className="profile-connectors">
                {active.connectors.length > 0 ? active.connectors.join(" · ") : "Aucune connexion"}
              </span>
            </span>
            <span className="profile-dot" aria-hidden="true" />
          </div>

          {others.length > 0 && <p className="profile-panel-label">Passer à un autre compte</p>}
          {others.map((account) => (
            <button
              key={account.id}
              type="button"
              role="menuitem"
              className="profile-account"
              disabled={busy}
              onClick={() => void run(() => window.api.accounts.switchTo(account.id))}
            >
              <span className="profile-avatar" aria-hidden="true">
                {initialOf(account)}
              </span>
              <span className="profile-identity">
                <span className="profile-name">{accountName(account)}</span>
                {account.email && <span className="profile-email">{account.email}</span>}
                <span className="profile-connectors">
                  {account.connectors.length > 0 ? account.connectors.join(" · ") : "Aucune connexion"}
                </span>
              </span>
            </button>
          ))}

          <div className="profile-divider" />
          <button
            type="button"
            role="menuitem"
            className="profile-action"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            <span className="profile-action-icon" aria-hidden="true">
              <GearIcon />
            </span>
            Réglages
          </button>
          <button
            type="button"
            role="menuitem"
            className="profile-action"
            disabled={busy}
            onClick={() => void run(() => window.api.accounts.add())}
          >
            <span className="profile-action-icon" aria-hidden="true">
              +
            </span>
            Ajouter un compte
          </button>
          <button
            type="button"
            role="menuitem"
            className="profile-action"
            disabled={busy}
            onClick={() => void run(() => window.api.accounts.logout())}
          >
            <span className="profile-action-icon" aria-hidden="true">
              ⎋
            </span>
            Se déconnecter
          </button>
          {error && (
            <p className="profile-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default ProfileMenu
