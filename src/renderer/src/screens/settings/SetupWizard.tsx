import { useState } from "react"
import type { ReactNode } from "react"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import "./settings.css"

export interface SetupWizardStep {
  title: string
  body: ReactNode
  /** Bouton « Ouvrir ↗ » de l'étape, quand elle renvoie à une page web. */
  open?: () => Promise<void>
}

interface SetupWizardProps {
  title: string
  intro?: ReactNode
  steps: SetupWizardStep[]
  /** Champs et contrôles propres au connecteur, sous les étapes. */
  children?: ReactNode
  /** Erreur de l'action principale (connexion), affichée sous les boutons. */
  error?: string | null
  /** Attente d'une autorisation dans le navigateur : remplace champs et boutons. */
  waiting?: { title: string; body?: ReactNode; abortLabel: string; aborting: boolean; onAbort: () => void }
  /** Bouton principal. Omis pour un guide purement informatif. */
  submit?: { label: string; disabled: boolean; onClick: () => void }
  /** Bouton secondaire (fermeture de l'assistant). */
  close?: { label: string; onClick: () => void }
}

/**
 * Coquille commune aux guides de connexion (Google Agenda, Jira, IA, Figma)
 * et aux guides des connecteurs pas encore branchés : étapes numérotées avec
 * un bouton « Ouvrir ↗ » optionnel, emplacement pour les champs, puis
 * boutons d'action. Les URL ne viennent jamais d'ici : chaque étape appelle
 * une action IPC qui prend un identifiant de liste blanche (voir
 * `docs/ipc/connector-setup-guides.md`).
 */
function SetupWizard({
  title,
  intro,
  steps,
  children,
  error,
  waiting,
  submit,
  close,
}: SetupWizardProps): React.JSX.Element {
  const [pageError, setPageError] = useState<string | null>(null)

  async function handleOpen(run: () => Promise<void>): Promise<void> {
    setPageError(null)
    try {
      await run()
    } catch (err) {
      setPageError(cleanIpcErrorMessage(err))
    }
  }

  const shownError = error ?? pageError

  return (
    <div className="setup-wizard">
      <p className="setup-wizard-title">{title}</p>
      {intro && <p className="setup-wizard-intro">{intro}</p>}

      <ol className="setup-wizard-steps">
        {steps.map((step, index) => {
          const open = step.open
          return (
            <li key={`${index}-${step.title}`} className="setup-wizard-step">
              <span className="setup-wizard-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <div className="setup-wizard-step-text">
                <span className="setup-wizard-step-title">{step.title}</span>
                <span className="setup-wizard-step-body">{step.body}</span>
              </div>
              {open && (
                <button
                  type="button"
                  className="settings-connect-button setup-wizard-open"
                  onClick={() => void handleOpen(open)}
                >
                  Ouvrir ↗
                </button>
              )}
            </li>
          )
        })}
      </ol>

      {waiting && (
        <div className="setup-wizard-waiting" role="status">
          <p className="setup-wizard-waiting-title">{waiting.title}</p>
          {waiting.body && <p className="settings-detail-hint">{waiting.body}</p>}
          <button
            type="button"
            className="settings-rotate-button settings-rotate-button--submit"
            disabled={waiting.aborting}
            onClick={waiting.onAbort}
          >
            {waiting.aborting ? "Annulation…" : waiting.abortLabel}
          </button>
        </div>
      )}

      {!waiting && children && <div className="setup-wizard-fields">{children}</div>}

      {!waiting && (submit || close) && (
        <div className="setup-wizard-actions">
          {submit && (
            <button
              type="button"
              className="settings-rotate-button settings-rotate-button--submit"
              disabled={submit.disabled}
              onClick={submit.onClick}
            >
              {submit.label}
            </button>
          )}
          {close && (
            <button type="button" className="settings-connect-button" onClick={close.onClick}>
              {close.label}
            </button>
          )}
        </div>
      )}

      {shownError && (
        <p className="settings-detail-error" role="alert">
          {shownError}
        </p>
      )}
    </div>
  )
}

export default SetupWizard
