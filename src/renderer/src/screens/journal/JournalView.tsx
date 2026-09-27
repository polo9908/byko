import { useEffect, useState } from "react"
import type { JournalEntry } from "@shared/journal"
import { AUTONOMY_MAX_LEVEL } from "@shared/autonomy"
import type { AutonomyCategory } from "@shared/autonomy"
import type { JiraTicketSummary } from "@shared/jira"
import { playSfx } from "@renderer/lib/sound"
import "../onboarding/onboarding.css"
import "./journal.css"

interface JournalViewProps {
  onBack?: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
}

/** `ipcRenderer.invoke` préfixe tout rejet avec "Error invoking remote method '<canal>': " : on l'enlève pour l'UI. */
function cleanIpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

/**
 * Écran Journal (ticket C1) + annulation (ticket C2). « En cours » liste les
 * vrais tickets Jira ouverts (E1, `jira:searchOpenIssues` — les mêmes que
 * ceux comptés dans la vue journée et créés en direct par B3), affichés en
 * cartes cliquables comme dans le prototype plutôt qu'en texte brut.
 * « Fait aujourd'hui » lit le vrai journal (`src/main/journal.ts`), rempli
 * au fil des actions réelles des intégrations (E1/E2/E5). « Annuler »
 * déclenche un vrai appel à l'intégration concernée (ex. suppression du
 * commentaire Jira), jamais un simple retrait visuel.
 */
function JournalView({ onBack }: JournalViewProps): React.JSX.Element {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null)
  const [openIssues, setOpenIssues] = useState<JiraTicketSummary[] | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<AutonomyCategory[]>([])

  useEffect(() => {
    window.api.journal.listToday().then(setEntries)
    window.api.autonomy.list().then(setCategories)
    window.api.jira.searchOpenIssues().then(setOpenIssues).catch(() => setOpenIssues([]))
  }, [])

  async function handleSetLevel(id: AutonomyCategory["id"], level: number): Promise<void> {
    setCategories(await window.api.autonomy.setLevel(id, level))
  }

  const doneCount = entries?.length ?? 0

  async function handleCancel(entry: JournalEntry): Promise<void> {
    const confirmed = window.confirm(`Annuler « ${entry.title} » ? Cette action a un effet réel sur Jira.`)
    if (!confirmed) return

    setCancellingId(entry.id)
    setError(null)
    try {
      await window.api.journal.cancel(entry.id)
      setEntries((current) => current?.filter((item) => item.id !== entry.id) ?? current)
      // Le prototype sonne `undo` à l'annulation d'une entrée — ici seulement une fois l'effet réel obtenu.
      playSfx("undo")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <div className="journal-screen">
      <div className="journal-page">
        {onBack && (
          <button type="button" className="onboarding-link onboarding-link--muted journal-back" onClick={onBack}>
            ‹ Retour
          </button>
        )}

        <p className="journal-eyebrow">Journal · aujourd&apos;hui</p>
        <h1 className="journal-title">
          {doneCount === 0
            ? "Je n'ai encore rien fait pour vous."
            : `J'ai fait ${doneCount} chose${doneCount > 1 ? "s" : ""} pour vous.`}
        </h1>

        <div className="journal-section">
          <p className="journal-section-label">En cours</p>
          {openIssues === null ? (
            <p className="journal-empty">Chargement…</p>
          ) : openIssues.length === 0 ? (
            <p className="journal-empty">Aucun ticket ouvert pour l&apos;instant.</p>
          ) : (
            openIssues.map((issue) => (
              <a
                key={issue.id}
                className="journal-ticket-row"
                href={issue.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="journal-ticket-key">{issue.key}</span>
                <span className="journal-ticket-summary">{issue.summary}</span>
                <span className="journal-ticket-status">{issue.status}</span>
                <span className="journal-ticket-chevron" aria-hidden="true">
                  ›
                </span>
              </a>
            ))
          )}
        </div>

        <div className="journal-section">
          <p className="journal-section-label">Fait aujourd&apos;hui</p>
          {entries === null ? (
            <p className="journal-empty">Chargement…</p>
          ) : entries.length === 0 ? (
            <p className="journal-empty">Rien à signaler pour aujourd&apos;hui.</p>
          ) : (
            entries.map((entry) => (
              <div className="journal-row" key={entry.id}>
                <span className="journal-row-time">{formatTime(entry.createdAt)}</span>
                <div className="journal-row-body">
                  {entry.url ? (
                    <a className="journal-row-link" href={entry.url} target="_blank" rel="noreferrer">
                      {entry.title}
                    </a>
                  ) : (
                    <span className="journal-row-title">{entry.title}</span>
                  )}
                  <span className="journal-row-tag">{entry.mode === "auto" ? "Fait seul" : "Fait avec vous"}</span>
                </div>
                {entry.undo && (
                  <button
                    type="button"
                    className="journal-row-cancel"
                    disabled={cancellingId === entry.id}
                    onClick={() => handleCancel(entry)}
                  >
                    {cancellingId === entry.id ? "Annulation…" : "Annuler"}
                  </button>
                )}
              </div>
            ))
          )}
          {error && <p className="onboarding-error">{error}</p>}
        </div>

        <div className="journal-section">
          <p className="journal-section-label">Ce que je fais seul</p>
          {categories.map((category) => (
            <div className="journal-autonomy-row" key={category.id}>
              <span className="journal-autonomy-label">{category.label}</span>
              <span className="journal-autonomy-dots">
                {Array.from({ length: AUTONOMY_MAX_LEVEL }).map((_, index) => {
                  const filled = index < category.level
                  const dotClass = filled
                    ? category.level === AUTONOMY_MAX_LEVEL
                      ? "journal-autonomy-dot journal-autonomy-dot--filled"
                      : "journal-autonomy-dot journal-autonomy-dot--partial"
                    : "journal-autonomy-dot"
                  return (
                    <button
                      key={index}
                      type="button"
                      className={dotClass}
                      aria-label={`Régler « ${category.label} » sur ${index + 1}/${AUTONOMY_MAX_LEVEL}`}
                      onClick={() => handleSetLevel(category.id, index + 1)}
                    />
                  )
                })}
              </span>
              <span className="journal-autonomy-status">
                {category.level === AUTONOMY_MAX_LEVEL
                  ? "Autonome"
                  : `Encore ${AUTONOMY_MAX_LEVEL - category.level} validation${
                      AUTONOMY_MAX_LEVEL - category.level > 1 ? "s" : ""
                    }`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default JournalView
