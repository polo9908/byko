import { Children, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { JournalEntry } from "@shared/journal"
import { AUTONOMY_MAX_LEVEL } from "@shared/autonomy"
import type { AutonomyCategory } from "@shared/autonomy"
import type { JiraTicketSummary } from "@shared/jira"
import { playSfx } from "@renderer/lib/sound"
import { collapse, flick, impulse, prefersReducedMotion, stagger } from "@renderer/lib/motion"
import MeetingDetail from "../dayview/MeetingDetail"
import { listReports } from "@renderer/lib/meetingReports"
import { useTicketLinks } from "@renderer/lib/useTicketLinks"
import TicketLinkChips from "../links/TicketLinkChips"
import type { ArchivedReport } from "@renderer/lib/meetingReports"
import "../onboarding/onboarding.css"
import "./journal.css"

interface JournalViewProps {
  onBack?: () => void
}

const REPORT_TITLE = "Point d'équipe"

function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
}

interface JournalSectionProps {
  emoji: string
  label: string
  /** `null` : pas de compteur (chargement, ou section sans liste à compter). */
  count: number | null
  loading?: boolean
  empty?: string
  /** Lignes visibles avant « Voir tout » : une section longue ne noie pas les autres. */
  limit: number
  children?: React.ReactNode
}

/** Une carte par thème : emoji + titre + compteur, quelques lignes, le reste derrière « Voir tout ». */
export function JournalSection({ emoji, label, count, loading = false, empty, limit, children }: JournalSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const rows = Children.toArray(children)
  const shown = expanded ? rows : rows.slice(0, limit)
  return (
    <section className="journal-section">
      <h2 className="journal-section-head">
        <span aria-hidden="true">{emoji}</span>
        <span className="journal-section-label">{label}</span>
        {count !== null && count > 0 && <span className="journal-section-count">{count}</span>}
      </h2>
      {loading ? (
        <p className="journal-empty">Chargement…</p>
      ) : rows.length === 0 && empty ? (
        <p className="journal-empty">{empty}</p>
      ) : (
        shown
      )}
      {rows.length > limit && (
        <button type="button" className="journal-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Voir moins" : `Voir tout (${rows.length})`}
        </button>
      )}
    </section>
  )
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
 *
 * Mouvement (voir `lib/motion.ts`) : la page entre en cascade, les lignes arrivent en ressort au
 * chargement, une entrée annulée — une fois l'effet réel obtenu — part d'une pichenette et la
 * liste se referme, le titre encaisse le décompte, et les pastilles d'autonomie éclosent une à une.
 */
function JournalView({ onBack }: JournalViewProps): React.JSX.Element {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null)
  const [openIssues, setOpenIssues] = useState<JiraTicketSummary[] | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<AutonomyCategory[]>([])
  const [reports] = useState<ArchivedReport[]>(() => listReports())
  const { links, setLinks } = useTicketLinks()
  const [openReport, setOpenReport] = useState<{ archived: ArchivedReport; origin: DOMRect } | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const doneCountRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const page = pageRef.current
    if (page) stagger(page.querySelectorAll<HTMLElement>(".journal-eyebrow, .journal-title, .journal-section"), 55)
  }, [])

  // Les lignes arrivent en cascade quand leurs données réelles sont chargées.
  useLayoutEffect(() => {
    if (openIssues) stagger(pageRef.current?.querySelectorAll<HTMLElement>(".journal-ticket-row") ?? [], 45)
  }, [openIssues])
  useLayoutEffect(() => {
    if (entries && doneCountRef.current === null) {
      stagger(pageRef.current?.querySelectorAll<HTMLElement>(".journal-row") ?? [], 45)
    }
  }, [entries])

  useEffect(() => {
    window.api.journal.listToday().then(setEntries)
    window.api.autonomy.list().then(setCategories)
    window.api.jira.searchOpenIssues().then(setOpenIssues).catch(() => setOpenIssues([]))
  }, [])

  async function handleSetLevel(id: AutonomyCategory["id"], level: number): Promise<void> {
    setCategories(await window.api.autonomy.setLevel(id, level))
    // Une fois le niveau réellement enregistré, les pastilles éclosent (ou se tassent) en partant de celle cliquée.
    requestAnimationFrame(() => {
      const dots = pageRef.current?.querySelectorAll<HTMLElement>(`[data-category-id="${id}"] .journal-autonomy-dot`)
      dots?.forEach((dot, j) => {
        setTimeout(() => impulse(dot, j < level ? 9 : -4), Math.abs(j - (level - 1)) * 45)
      })
    })
  }

  const doneCount = entries?.length ?? 0

  // Le titre encaisse chaque décompte (il se tasse puis rebondit).
  useLayoutEffect(() => {
    if (entries === null) return
    if (doneCountRef.current !== null && doneCountRef.current !== doneCount && titleRef.current) {
      impulse(titleRef.current, -2.5)
    }
    doneCountRef.current = doneCount
  }, [entries, doneCount])

  async function handleCancel(entry: JournalEntry): Promise<void> {
    const confirmed = window.confirm(`Annuler « ${entry.title} » ? Cette action a un effet réel sur Jira.`)
    if (!confirmed) return

    setCancellingId(entry.id)
    setError(null)
    try {
      await window.api.journal.cancel(entry.id)
      // L'effet réel est obtenu : la ligne part d'une pichenette, la liste se referme, puis elle quitte l'état.
      const row = pageRef.current?.querySelector<HTMLElement>(`[data-entry-id="${entry.id}"]`)
      if (row && !prefersReducedMotion()) {
        flick(row, -1)
        await collapse(row)
      }
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
      <div className="journal-page" ref={pageRef}>
        {onBack && (
          <button type="button" className="onboarding-link onboarding-link--muted journal-back" onClick={onBack}>
            ‹ Retour
          </button>
        )}

        <p className="journal-eyebrow">Journal · aujourd&apos;hui</p>
        <h1 className="journal-title" ref={titleRef}>
          {doneCount === 0
            ? "Je n'ai encore rien fait pour vous."
            : `J'ai fait ${doneCount} chose${doneCount > 1 ? "s" : ""} pour vous.`}
        </h1>

        <JournalSection emoji="🎫" label="En cours" count={openIssues?.length ?? null} loading={openIssues === null} empty="Aucun ticket ouvert pour l'instant." limit={4}>
          {(openIssues ?? []).map((issue) => (
            <a key={issue.id} className="journal-ticket-row" href={issue.url} target="_blank" rel="noreferrer">
              <span className="journal-ticket-key">{issue.key}</span>
              <span className="journal-ticket-summary">{issue.summary}</span>
              <span className="journal-ticket-status">{issue.status}</span>
            </a>
          ))}
        </JournalSection>

        <JournalSection emoji="✅" label="Fait aujourd'hui" count={entries?.length ?? null} loading={entries === null} empty="Rien à signaler pour aujourd'hui." limit={5}>
          {(entries ?? []).map((entry) => (
            <div className="journal-row" key={entry.id} data-entry-id={entry.id}>
              <span className="journal-row-time">{formatTime(entry.createdAt)}</span>
              <div className="journal-row-body">
                {entry.url ? (
                  <a className="journal-row-link" href={entry.url} target="_blank" rel="noreferrer">
                    {entry.title}
                  </a>
                ) : (
                  <span className="journal-row-title">{entry.title}</span>
                )}
              </div>
              <span className="journal-row-tag" title={entry.mode === "auto" ? "Fait seul" : "Fait avec vous"}>
                {entry.mode === "auto" ? "🤖 Seul" : "🤝 À deux"}
              </span>
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
          ))}
          {error && <p className="onboarding-error">{error}</p>}
        </JournalSection>

        {links && links.tickets.length > 0 && (
          <JournalSection emoji="🔗" label="Tickets de réunion suivis" count={links.tickets.length} limit={4}>
            {links.tickets.map((ticket) => (
              <div key={ticket.issueKey} className="journal-link-row">
                <a className="journal-link-head" href={ticket.url} target="_blank" rel="noreferrer">
                  <span className="journal-ticket-key">{ticket.issueKey}</span>
                  <span className="journal-ticket-summary">{ticket.summary}</span>
                </a>
                <TicketLinkChips ticket={ticket} onChange={setLinks} />
                {ticket.pullRequests.length === 0 && ticket.designs.length === 0 && !ticket.pendingTransition && (
                  <p className="journal-link-none">Aucune pull request ni maquette reliée pour l&apos;instant.</p>
                )}
              </div>
            ))}
          </JournalSection>
        )}

        {reports.length > 0 && (
          <JournalSection emoji="📝" label="Réunions passées" count={reports.length} limit={3}>
            {reports.map((archived) => {
              const decisions = archived.report.items.filter((item) => item.type === "decision").length
              const tickets = archived.report.items.filter((item) => item.jiraKey).length
              return (
                <button
                  key={archived.day}
                  type="button"
                  className="journal-ticket-row journal-report-row"
                  onClick={(event) => setOpenReport({ archived, origin: event.currentTarget.getBoundingClientRect() })}
                >
                  <span className="journal-ticket-summary">
                    {REPORT_TITLE}
                    <span className="journal-report-meta">{formatDay(archived.day)}</span>
                  </span>
                  {decisions > 0 && <span className="journal-pill">💡 {decisions}</span>}
                  {tickets > 0 && <span className="journal-pill">🎫 {tickets}</span>}
                  <span className="journal-ticket-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              )
            })}
          </JournalSection>
        )}

        <JournalSection emoji="🤖" label="Ce que je fais seul" count={null} limit={categories.length || 1}>
          {categories.map((category) => (
            <div className="journal-autonomy-row" key={category.id} data-category-id={category.id}>
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
        </JournalSection>
      </div>
      {openReport && (
        <MeetingDetail
          meeting={{ label: REPORT_TITLE, startMinutes: 0 }}
          origin={openReport.origin}
          report={openReport.archived.report}
          dateLabel={formatDay(openReport.archived.day)}
          onClose={() => setOpenReport(null)}
        />
      )}
    </div>
  )
}

export default JournalView
