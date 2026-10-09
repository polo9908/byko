import { useEffect, useRef, useState } from "react"
import type { LinksState } from "@shared/links"
import { LINKS_INPUT_MAX_CHARS } from "@shared/links"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import "./settings.css"
import "../links/links.css"

interface TicketLinksSettingsProps {
  githubConnected: boolean
  figmaConnected: boolean
}

function formatSync(iso: string | undefined): string {
  if (!iso) return "Jamais synchronisé."
  const date = new Date(iso)
  return `Dernière synchronisation : ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`
}

/**
 * Sources de la liaison automatique (contrat : docs/ipc/ticket-links.md) : dépôts GitHub et fichiers Figma dans
 * lesquels BYKO cherche la clé des tickets créés en réunion. Le renderer n'envoie qu'un nom de dépôt ou le lien d'un
 * fichier ; main en extrait l'identifiant, vérifie l'accès et construit lui-même les adresses appelées.
 */
function TicketLinksSettings({ githubConnected, figmaConnected }: TicketLinksSettingsProps): React.JSX.Element {
  const [state, setState] = useState<LinksState | null>(null)
  const [repo, setRepo] = useState("")
  const [file, setFile] = useState("")
  const [busy, setBusy] = useState<"repo" | "file" | "sync" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.api.links
      .getState()
      .then((result) => {
        if (mountedRef.current) setState(result)
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setError(cleanIpcErrorMessage(err))
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function run(kind: "repo" | "file" | "sync", action: () => Promise<LinksState>, sound = true): Promise<boolean> {
    if (busy) return false
    setBusy(kind)
    setError(null)
    try {
      const result = await action()
      if (!mountedRef.current) return false
      setState(result)
      if (sound) playSfx("saved")
      return true
    } catch (err) {
      if (mountedRef.current) setError(cleanIpcErrorMessage(err))
      return false
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  async function handleAddRepo(): Promise<void> {
    if (await run("repo", () => window.api.links.addRepo(repo.trim()))) setRepo("")
  }

  async function handleAddFile(): Promise<void> {
    if (await run("file", () => window.api.links.addFigmaFile(file.trim()))) setFile("")
  }

  return (
    <>
      <p className="settings-section-label">Liaison des tickets</p>
      <div className="settings-privacy-help">
        <p className="settings-detail-hint settings-privacy-text">
          Les tickets créés pendant un point d&apos;équipe sont reliés seuls à leur pull request (clé du ticket, par
          exemple « PROJ-123 », dans le nom de la branche, le titre ou la description), à leur maquette (clé dans le
          nom d&apos;une page, d&apos;une section ou d&apos;un cadre Figma) et à la release qui les livre. Une fusion,
          une maquette passée « Ready for dev » ou une release sont signalées en commentaire sur le ticket.
        </p>
      </div>

      <p className="settings-section-label">Dépôts GitHub suivis</p>
      {state && state.repos.length > 0 && (
        <ul className="settings-links-list">
          {state.repos.map((entry) => (
            <li key={entry.name} className="settings-links-item">
              <span className="settings-links-item-name">{entry.name}</span>
              <button
                type="button"
                className="settings-connect-button"
                disabled={busy !== null}
                onClick={() => void run("repo", () => window.api.links.removeRepo(entry.name), false)}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
      {githubConnected ? (
        <div className="settings-links-add">
          <input
            className="settings-detail-input"
            type="text"
            aria-label="Dépôt GitHub à suivre"
            placeholder="propriétaire/dépôt"
            spellCheck={false}
            maxLength={LINKS_INPUT_MAX_CHARS}
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && repo.trim()) void handleAddRepo()
            }}
          />
          <button
            type="button"
            className="settings-connect-button"
            disabled={busy !== null || repo.trim() === ""}
            onClick={() => void handleAddRepo()}
          >
            {busy === "repo" ? "Vérification…" : "Suivre"}
          </button>
        </div>
      ) : (
        <div className="settings-privacy-help">
          <p className="settings-detail-hint settings-privacy-text">Connectez GitHub ci-dessus pour suivre un dépôt.</p>
        </div>
      )}

      <p className="settings-section-label">Fichiers Figma suivis</p>
      {state && state.figmaFiles.length > 0 && (
        <ul className="settings-links-list">
          {state.figmaFiles.map((entry) => (
            <li key={entry.key} className="settings-links-item">
              <span className="settings-links-item-name">{entry.name}</span>
              <button
                type="button"
                className="settings-connect-button"
                disabled={busy !== null}
                onClick={() => void run("file", () => window.api.links.removeFigmaFile(entry.key), false)}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
      {figmaConnected ? (
        <div className="settings-links-add">
          <input
            className="settings-detail-input"
            type="text"
            aria-label="Lien du fichier Figma à suivre"
            placeholder="Lien du fichier (figma.com/design/…)"
            spellCheck={false}
            maxLength={LINKS_INPUT_MAX_CHARS}
            value={file}
            onChange={(event) => setFile(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && file.trim()) void handleAddFile()
            }}
          />
          <button
            type="button"
            className="settings-connect-button"
            disabled={busy !== null || file.trim() === ""}
            onClick={() => void handleAddFile()}
          >
            {busy === "file" ? "Vérification…" : "Suivre"}
          </button>
        </div>
      ) : (
        <div className="settings-privacy-help">
          <p className="settings-detail-hint settings-privacy-text">Connectez Figma ci-dessus pour suivre un fichier.</p>
        </div>
      )}

      <div className="settings-privacy-help">
        <button
          type="button"
          className="settings-connect-button"
          disabled={busy !== null}
          onClick={() => void run("sync", () => window.api.links.sync())}
        >
          {busy === "sync" ? "Synchronisation…" : "Synchroniser maintenant"}
        </button>
        {state && (
          <p className="settings-detail-hint settings-privacy-text" role="status">
            {formatSync(state.lastSyncAt)} {state.tickets.length}{" "}
            {state.tickets.length > 1 ? "tickets suivis" : "ticket suivi"}. Relève automatique toutes les 5 minutes
            tant que BYKO est ouvert.
          </p>
        )}
        {state?.errors.map((message) => (
          <p key={message} className="settings-detail-error">
            {message}
          </p>
        ))}
        {error && (
          <p className="settings-detail-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  )
}

export default TicketLinksSettings
