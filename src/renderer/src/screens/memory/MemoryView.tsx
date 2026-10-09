import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  MEMORY_DECISION_MAX,
  MEMORY_KEY_MAX,
  MEMORY_PEOPLE_MAX,
  MEMORY_QUERY_MAX,
  MEMORY_QUERY_MIN,
  MEMORY_TITLE_MAX,
  MEMORY_WHY_MAX,
} from "@shared/memory"
import type { DecisionProposal, DecisionRecord, MemoryHit, MemoryHitKind, MemoryState } from "@shared/memory"
import { cleanIpcErrorMessage } from "@renderer/lib/ipcError"
import { dayKey, listReports } from "@renderer/lib/meetingReports"
import type { ArchivedReport } from "@renderer/lib/meetingReports"
import { stagger } from "@renderer/lib/motion"
import { playSfx } from "@renderer/lib/sound"
import MeetingDetail from "../dayview/MeetingDetail"
import { JournalSection } from "../journal/JournalView"
import "../onboarding/onboarding.css"
import "../journal/journal.css"
import "./memory.css"

interface MemoryViewProps {
  onBack: () => void
}

interface FormState {
  id?: string
  sourceId?: string
  title: string
  decision: string
  why: string
  people: string
  decidedAt: string
  key: boolean
}

const KIND_LABEL: Record<MemoryHitKind, string> = {
  decision: "Décision",
  meeting: "Réunion",
  term: "Vocabulaire",
  ticket: "Ticket",
  "pull-request": "Pull request",
  design: "Maquette",
}

const REPORT_TITLE = "Point d'équipe"
const REPORT_HITS_MAX = 3

function formatDay(day: string, long = false): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(
    "fr-FR",
    long ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short", year: "numeric" },
  )
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}

function emptyForm(): FormState {
  return { title: "", decision: "", why: "", people: "", decidedAt: dayKey(new Date()), key: false }
}

interface DecisionRowProps {
  item: DecisionRecord
  /** Rang dans le parcours d'arrivée ; absent : la date de la décision est affichée à la place. */
  rank?: number
  open: boolean
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
}

/** Une décision : son sujet sur une ligne, puis — dépliée — ce qui a été tranché, pourquoi, et qui sait. */
function DecisionRow({ item, rank, open, busy, onToggle, onEdit, onRemove }: DecisionRowProps): React.JSX.Element {
  return (
    <div className="memory-decision" data-decision-id={item.id}>
      <button type="button" className="journal-ticket-row journal-report-row" aria-expanded={open} onClick={onToggle}>
        <span className="memory-decision-date">{rank !== undefined ? `${rank}.` : formatDay(item.decidedAt)}</span>
        <span className="journal-ticket-summary">{item.title}</span>
        {rank === undefined && item.key && <span className="journal-pill">🧭 Clé</span>}
        <span className={"journal-ticket-chevron" + (open ? " memory-chevron--open" : "")} aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className="memory-decision-body">
          <p className="memory-decision-text">{item.decision}</p>
          {item.why && (
            <>
              <p className="memory-decision-label">Pourquoi</p>
              <p className="memory-decision-text memory-decision-text--muted">{item.why}</p>
            </>
          )}
          <p className="memory-decision-meta">
            {[rank !== undefined ? formatDay(item.decidedAt) : "", item.people.length > 0 ? `À contacter : ${item.people.join(", ")}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="memory-actions">
            <button type="button" className="journal-row-cancel" disabled={busy} onClick={onEdit}>
              Modifier
            </button>
            <button type="button" className="journal-row-cancel memory-action--muted" disabled={busy} onClick={onRemove}>
              Supprimer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Mémoire d'équipe (contrat : docs/ipc/team-memory.md) : les décisions consignées avec leur pourquoi, celles que les
 * réunions viennent de faire émerger, le parcours d'arrivée (les décisions clés, dans l'ordre), qui sait quoi, et une
 * recherche unique sur tout ce que BYKO connaît — décisions, réunions, vocabulaire, tickets, pull requests, maquettes.
 * Même mise en page que le Journal ; rien n'est affiché qui ne vienne d'une vraie source.
 */
function MemoryView({ onBack }: MemoryViewProps): React.JSX.Element {
  const [state, setState] = useState<MemoryState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<MemoryHit[] | null>(null)
  const [answer, setAnswer] = useState<{ question: string; text: string } | null>(null)
  const [asking, setAsking] = useState(false)
  const [reports] = useState<ArchivedReport[]>(() => listReports())
  const [openReport, setOpenReport] = useState<{ archived: ArchivedReport; origin: DOMRect } | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useLayoutEffect(() => {
    const page = pageRef.current
    if (page) stagger(page.querySelectorAll<HTMLElement>(".journal-eyebrow, .journal-title, .memory-search, .journal-section"), 55)
  }, [])

  useEffect(() => {
    let mounted = true
    window.api.memory
      .get()
      .then((next) => {
        if (mounted) setState(next)
      })
      .catch((err: unknown) => {
        if (mounted) setError(cleanIpcErrorMessage(err))
      })
    return () => {
      mounted = false
    }
  }, [])

  const text = query.trim()
  const searching = text.length >= MEMORY_QUERY_MIN

  // Recherche locale pendant la frappe ; une réponse arrivée après une nouvelle saisie est ignorée.
  useEffect(() => {
    if (!searching) {
      setHits(null)
      return
    }
    let current = true
    const timer = setTimeout(() => {
      window.api.memory
        .search(text)
        .then((found) => {
          if (current) setHits(found)
        })
        .catch((err: unknown) => {
          if (current) setError(cleanIpcErrorMessage(err))
        })
    }, 180)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [text, searching])

  // Les comptes rendus vivent dans le renderer (voir `lib/meetingReports.ts`) : ils sont cherchés ici.
  const reportHits = useMemo(() => {
    if (!searching) return []
    const terms = fold(text).split(/\s+/)
    return reports
      .filter(({ report }) => {
        const haystack = fold([report.summary, ...report.items.map((item) => item.text)].join(" "))
        return terms.every((term) => haystack.includes(term))
      })
      .slice(0, REPORT_HITS_MAX)
  }, [reports, searching, text])

  const decisions = useMemo(() => state?.decisions ?? [], [state])
  const keyDecisions = useMemo(
    () => decisions.filter((item) => item.key).sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
    [decisions],
  )
  // Qui sait quoi : déduit des personnes citées sur chaque décision, sans fiche à tenir à jour.
  const experts = useMemo(() => {
    const byName = new Map<string, { name: string; topics: string[] }>()
    for (const item of decisions) {
      for (const name of item.people) {
        const entry = byName.get(name.toLowerCase()) ?? { name, topics: [] }
        entry.topics.push(item.title)
        byName.set(name.toLowerCase(), entry)
      }
    }
    return [...byName.values()].sort((a, b) => b.topics.length - a.topics.length || a.name.localeCompare(b.name, "fr"))
  }, [decisions])

  async function run(action: () => Promise<MemoryState>): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      setState(await action())
      playSfx("tick")
      return true
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  function openForm(next: FormState): void {
    setError(null)
    setQuery("")
    setForm(next)
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: "nearest" })
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus()
    })
  }

  function editDecision(item: DecisionRecord): void {
    openForm({
      id: item.id,
      title: item.title,
      decision: item.decision,
      why: item.why ?? "",
      people: item.people.join(", "),
      decidedAt: item.decidedAt,
      key: item.key,
    })
  }

  function consign(proposal: DecisionProposal): void {
    // Le texte relevé en réunion devient la décision ; le sujet et le pourquoi restent à préciser.
    openForm({ ...emptyForm(), sourceId: proposal.id, decision: proposal.text.slice(0, MEMORY_DECISION_MAX), decidedAt: proposal.day })
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!form) return
    const people = form.people
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "")
    const done = await run(() =>
      window.api.memory.save({
        ...(form.id ? { id: form.id } : {}),
        ...(form.sourceId ? { sourceId: form.sourceId } : {}),
        title: form.title,
        decision: form.decision,
        ...(form.why.trim() ? { why: form.why } : {}),
        people,
        decidedAt: form.decidedAt,
        key: form.key,
      }),
    )
    if (done) setForm(null)
  }

  async function handleRemove(item: DecisionRecord): Promise<void> {
    if (!window.confirm(`Supprimer « ${item.title} » de la mémoire d'équipe ?`)) return
    await run(() => window.api.memory.remove(item.id))
  }

  async function handleAsk(): Promise<void> {
    if (asking || !searching) return
    setAsking(true)
    setError(null)
    setAnswer(null)
    try {
      setAnswer({ question: text, text: await window.api.memory.ask(text) })
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setAsking(false)
    }
  }

  const rowProps = (item: DecisionRecord, scope: string): Omit<DecisionRowProps, "item" | "rank"> => ({
    open: openId === `${scope}:${item.id}`,
    busy,
    onToggle: () => setOpenId(openId === `${scope}:${item.id}` ? null : `${scope}:${item.id}`),
    onEdit: () => editDecision(item),
    onRemove: () => void handleRemove(item),
  })

  const count = decisions.length
  const keyFull = keyDecisions.length >= MEMORY_KEY_MAX && !keyDecisions.some((item) => item.id === form?.id)

  return (
    <div className="journal-screen">
      <div className="journal-page" ref={pageRef}>
        <button type="button" className="onboarding-link onboarding-link--muted journal-back" onClick={onBack}>
          ‹ Retour
        </button>

        <p className="journal-eyebrow">Mémoire d&apos;équipe</p>
        <h1 className="journal-title">
          {state === null
            ? "Mémoire d'équipe"
            : count === 0
              ? "Rien n'est encore consigné."
              : `${count} décision${count > 1 ? "s" : ""} à portée de main.`}
        </h1>

        <div className="memory-search">
          <input
            type="search"
            className="onboarding-input memory-search-input"
            placeholder="Chercher une décision, un terme, un ticket, une maquette…"
            aria-label="Chercher dans la mémoire d'équipe"
            maxLength={MEMORY_QUERY_MAX}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setAnswer(null)
            }}
          />
          {!form && (
            <button type="button" className="global-journal-button memory-add" onClick={() => openForm(emptyForm())}>
              + Consigner une décision
            </button>
          )}
        </div>

        {error && (
          <p className="onboarding-error memory-error" role="alert">
            {error}
          </p>
        )}

        {form && (
          <form className="journal-section memory-form" ref={formRef} onSubmit={(event) => void handleSubmit(event)}>
            <h2 className="journal-section-head">
              <span aria-hidden="true">✍️</span>
              <span className="journal-section-label">{form.id ? "Modifier la décision" : "Consigner une décision"}</span>
            </h2>
            <input
              className="onboarding-input"
              placeholder="Le sujet (ex. Pourquoi GraphQL plutôt que REST ?)"
              aria-label="Sujet de la décision"
              maxLength={MEMORY_TITLE_MAX}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <textarea
              className="onboarding-input memory-textarea"
              placeholder="Ce qui a été décidé"
              aria-label="Ce qui a été décidé"
              rows={2}
              maxLength={MEMORY_DECISION_MAX}
              value={form.decision}
              onChange={(event) => setForm({ ...form, decision: event.target.value })}
            />
            <textarea
              className="onboarding-input memory-textarea"
              placeholder="Pourquoi : le contexte, les options écartées (facultatif)"
              aria-label="Pourquoi"
              rows={4}
              maxLength={MEMORY_WHY_MAX}
              value={form.why}
              onChange={(event) => setForm({ ...form, why: event.target.value })}
            />
            <div className="memory-form-row">
              <input
                className="onboarding-input memory-form-people"
                placeholder={`Qui contacter (noms séparés par des virgules, ${MEMORY_PEOPLE_MAX} maximum)`}
                aria-label="Qui contacter à ce sujet"
                value={form.people}
                onChange={(event) => setForm({ ...form, people: event.target.value })}
              />
              <input
                type="date"
                className="onboarding-input"
                aria-label="Date de la décision"
                required
                value={form.decidedAt}
                onChange={(event) => setForm({ ...form, decidedAt: event.target.value })}
              />
            </div>
            <label className="memory-form-key">
              <input
                type="checkbox"
                checked={form.key}
                disabled={keyFull && !form.key}
                onChange={(event) => setForm({ ...form, key: event.target.checked })}
              />
              <span>
                Décision clé : à lire en premier par un nouvel arrivant
                {keyFull && !form.key ? ` (les ${MEMORY_KEY_MAX} places sont prises)` : ""}
              </span>
            </label>
            <div className="memory-actions memory-actions--form">
              <button
                type="submit"
                className="onboarding-button onboarding-button--primary memory-submit"
                disabled={busy || form.title.trim() === "" || form.decision.trim() === "" || form.decidedAt === ""}
              >
                Enregistrer
              </button>
              <button type="button" className="onboarding-link onboarding-link--muted" onClick={() => setForm(null)}>
                Annuler
              </button>
            </div>
          </form>
        )}

        {searching ? (
          <>
            <JournalSection
              emoji="🔎"
              label="Résultats"
              count={hits ? hits.length + reportHits.length : null}
              loading={hits === null}
              empty="Rien ne correspond. Essayez d'autres mots, ou posez la question à BCC."
              limit={12}
            >
              {(hits ?? []).map((hit) => {
                const inner = (
                  <>
                    <span className="journal-pill">{KIND_LABEL[hit.kind]}</span>
                    <span className="journal-ticket-summary">
                      {hit.title}
                      {hit.detail && <span className="journal-report-meta memory-hit-detail">{hit.detail}</span>}
                    </span>
                  </>
                )
                if (hit.url) {
                  return (
                    <a key={hit.id} className="journal-ticket-row" href={hit.url} target="_blank" rel="noreferrer">
                      {inner}
                    </a>
                  )
                }
                // Une décision consignée se déplie sur place : pas besoin de quitter la recherche pour la lire.
                const decision = hit.kind === "decision" ? decisions.find((item) => `decision:${item.id}` === hit.id) : undefined
                if (decision) return <DecisionRow key={hit.id} item={decision} {...rowProps(decision, "hit")} />
                return (
                  <div key={hit.id} className="journal-ticket-row">
                    {inner}
                  </div>
                )
              })}
              {reportHits.map((archived) => (
                <button
                  key={`report:${archived.day}`}
                  type="button"
                  className="journal-ticket-row journal-report-row"
                  onClick={(event) => setOpenReport({ archived, origin: event.currentTarget.getBoundingClientRect() })}
                >
                  <span className="journal-pill">Compte rendu</span>
                  <span className="journal-ticket-summary">
                    {REPORT_TITLE}
                    <span className="journal-report-meta">{formatDay(archived.day, true)}</span>
                  </span>
                  <span className="journal-ticket-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </JournalSection>

            <section className="journal-section memory-ask">
              <button type="button" className="global-journal-button" disabled={asking} onClick={() => void handleAsk()}>
                {asking ? "BCC cherche…" : "Demander à BCC"}
              </button>
              <span className="memory-ask-hint">
                BCC répond à partir des décisions consignées, envoyées à votre IA pour cette question.
              </span>
              {answer && answer.question === text && (
                <p className="memory-answer" role="status">
                  {answer.text}
                </p>
              )}
            </section>
          </>
        ) : (
          <>
            {state && state.proposals.length > 0 && (
              <JournalSection emoji="💡" label="Décidé en réunion, à consigner" count={state.proposals.length} limit={3}>
                {state.proposals.map((proposal) => (
                  <div className="journal-row" key={proposal.id}>
                    <div className="journal-row-body">
                      <span className="journal-row-title">{proposal.text}</span>
                      <span className="journal-row-tag">Point d&apos;équipe du {formatDay(proposal.day)}</span>
                    </div>
                    <button type="button" className="journal-row-cancel" disabled={busy} onClick={() => consign(proposal)}>
                      Consigner
                    </button>
                    <button
                      type="button"
                      className="journal-row-cancel memory-action--muted"
                      disabled={busy}
                      onClick={() => void run(() => window.api.memory.dismissProposal(proposal.id))}
                    >
                      Ignorer
                    </button>
                  </div>
                ))}
              </JournalSection>
            )}

            <JournalSection
              emoji="🧭"
              label="Pour comprendre le projet"
              count={keyDecisions.length}
              loading={state === null}
              empty={`Marquez jusqu'à ${MEMORY_KEY_MAX} décisions comme « clés » : un nouvel arrivant les lira ici, dans l'ordre.`}
              limit={MEMORY_KEY_MAX}
            >
              {keyDecisions.map((item, index) => (
                <DecisionRow key={item.id} item={item} rank={index + 1} {...rowProps(item, "key")} />
              ))}
            </JournalSection>

            <JournalSection
              emoji="📚"
              label="Toutes les décisions"
              count={count}
              loading={state === null}
              empty="Consignez la première : le sujet, ce qui a été décidé, et pourquoi."
              limit={6}
            >
              {decisions.map((item) => (
                <DecisionRow key={item.id} item={item} {...rowProps(item, "all")} />
              ))}
            </JournalSection>

            {experts.length > 0 && (
              <JournalSection emoji="🙋" label="Qui sait quoi" count={experts.length} limit={5}>
                {experts.map((expert) => (
                  <button
                    key={expert.name}
                    type="button"
                    className="journal-ticket-row journal-report-row"
                    title={`Voir ce que ${expert.name} a décidé`}
                    onClick={() => setQuery(expert.name)}
                  >
                    <span className="memory-expert-name">{expert.name}</span>
                    <span className="journal-ticket-summary memory-expert-topics">{expert.topics.join(" · ")}</span>
                    <span className="journal-pill">{expert.topics.length}</span>
                  </button>
                ))}
              </JournalSection>
            )}
          </>
        )}
      </div>
      {openReport && (
        <MeetingDetail
          meeting={{ label: REPORT_TITLE, startMinutes: 0 }}
          origin={openReport.origin}
          report={openReport.archived.report}
          dateLabel={formatDay(openReport.archived.day, true)}
          onClose={() => setOpenReport(null)}
        />
      )}
    </div>
  )
}

export default MemoryView
