import { useState } from "react"
import type { DesignStatus, LinksState, PullRequestState, TrackedTicket } from "@shared/links"
import { cleanIpcErrorMessage } from "@renderer/lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import "./links.css"

const PR_STATE_LABELS: Record<PullRequestState, string> = {
  open: "Ouverte",
  merged: "Fusionnée",
  closed: "Fermée",
}

const DESIGN_STATUS_LABELS: Record<DesignStatus, string> = {
  in_progress: "En cours",
  ready_for_dev: "Validée",
  completed: "Terminée",
}

interface TicketLinkChipsProps {
  ticket: TrackedTicket
  /** Reçoit l'état renvoyé par main après une validation ou un refus du changement de statut. */
  onChange: (state: LinksState) => void
}

/**
 * Liens d'un ticket créé en réunion : pull requests, release qui les livre, maquettes Figma. Chaque pastille dit son
 * état en toutes lettres (jamais par la seule couleur) et ouvre la page dans le navigateur. Quand toutes les pull
 * requests sont fusionnées, le passage du ticket à « terminé » se valide ici tant que la catégorie n'est pas autonome.
 */
function TicketLinkChips({ ticket, onChange }: TicketLinkChipsProps): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resolve(accept: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onChange(await window.api.links.resolveTransition(ticket.issueKey, accept))
      playSfx(accept ? "saved" : "tick")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (ticket.pullRequests.length === 0 && ticket.designs.length === 0 && !ticket.pendingTransition) return null

  return (
    <div className="link-chips">
      {ticket.pullRequests.map((pullRequest) => (
        <span key={`${pullRequest.repo}#${pullRequest.number}`} className="link-chips-group">
          <a
            className="link-chip"
            data-done={pullRequest.state === "merged"}
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            title={`${pullRequest.repo} — ${pullRequest.title}`}
          >
            PR #{pullRequest.number} · {PR_STATE_LABELS[pullRequest.state]}
          </a>
          {pullRequest.release && (
            <a className="link-chip" data-done href={pullRequest.release.url} target="_blank" rel="noreferrer">
              Release {pullRequest.release.name}
            </a>
          )}
        </span>
      ))}
      {ticket.designs.map((design) => (
        <a
          key={`${design.fileKey}:${design.nodeId}`}
          className="link-chip"
          data-done={design.status !== "in_progress"}
          href={design.url}
          target="_blank"
          rel="noreferrer"
          title={design.name}
        >
          Maquette · {DESIGN_STATUS_LABELS[design.status]}
        </a>
      ))}
      {ticket.pendingTransition && (
        <span className="link-chips-ask">
          Passer {ticket.issueKey} à « {ticket.pendingTransition} » ?
          <button type="button" className="link-chips-action" disabled={busy} onClick={() => void resolve(true)}>
            Valider
          </button>
          <button
            type="button"
            className="link-chips-action link-chips-action--muted"
            disabled={busy}
            onClick={() => void resolve(false)}
          >
            Ignorer
          </button>
        </span>
      )}
      {error && (
        <span className="link-chips-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export default TicketLinkChips
