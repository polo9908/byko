import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { collapse, enter, flick, impulse, prefersReducedMotion, spring, SPRINGS, stagger } from "@renderer/lib/motion"
import type { Spring } from "@renderer/lib/motion"
import { loadMemos, newMemo, saveMemos, sortMemos } from "@renderer/lib/memos"
import type { Memo } from "@renderer/lib/memos"
import { playSfx } from "@renderer/lib/sound"
import type { StoredMeetingReport } from "@renderer/lib/meetingReports"
import { PeopleChips, PersonText } from "./People"
import { useTicketLinks } from "@renderer/lib/useTicketLinks"
import TicketLinkChips from "../links/TicketLinkChips"
import "./meetingdetail.css"

export interface MeetingInfo {
  label: string
  startMinutes: number
  endMinutes?: number
  location?: string
  meetingUrl?: string
  attendees?: string[]
}

interface MeetingDetailProps {
  meeting: MeetingInfo
  /** Rectangle du jalon cliqué : la carte en naît et y retourne. */
  origin: DOMRect | null
  /** Compte rendu du jour (point d'équipe) : rapport, décisions et tickets créés pendant l'enregistrement. */
  report?: StoredMeetingReport | null
  /** Consultation d'un compte rendu passé (depuis le Journal) : date lisible à la place de l'horaire et de l'état. */
  dateLabel?: string
  /** Présent pour un « point d'équipe » ou une réunion en cours : ouvre l'écran d'enregistrement. */
  onOpenMeeting?: () => void
  openLabel?: string
  onClose: () => void
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")
  const m = Math.floor(minutes % 60)
    .toString()
    .padStart(2, "0")
  return `${h}:${m}`
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m.toString().padStart(2, "0")}`
}

/** Où en est le rendez-vous : phrase + avancement (0→1) pour un bloc en cours. */
function describeStatus(meeting: MeetingInfo, nowMinutes: number): { text: string; progress: number | null } {
  const { startMinutes, endMinutes } = meeting
  if (endMinutes !== undefined && nowMinutes >= startMinutes && nowMinutes < endMinutes) {
    return {
      text: `En cours · reste ${formatDuration(Math.ceil(endMinutes - nowMinutes))}`,
      progress: (nowMinutes - startMinutes) / (endMinutes - startMinutes),
    }
  }
  const end = endMinutes ?? startMinutes
  if (nowMinutes >= end) return { text: "Terminé", progress: endMinutes !== undefined ? 1 : null }
  return { text: `Dans ${formatDuration(Math.ceil(startMinutes - nowMinutes))}`, progress: endMinutes !== undefined ? 0 : null }
}

/** Nom lisible du service de visio, d'après le domaine (déjà validé en https côté main). */
function providerOf(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "")
  const known: [RegExp, string][] = [
    [/(^|\.)meet\.google\.com$/, "Google Meet"],
    [/(^|\.)zoom(gov)?\.(us|com)$/, "Zoom"],
    [/(^|\.)teams\.(microsoft|live)\.com$/, "Microsoft Teams"],
    [/(^|\.)webex\.com$/, "Webex"],
    [/(^|\.)whereby\.com$/, "Whereby"],
    [/(^|\.)meet\.jit\.si$/, "Jitsi"],
  ]
  return known.find(([pattern]) => pattern.test(host))?.[1] ?? host
}

const OPEN_SPRING = { stiffness: 230, damping: 19 }

/**
 * Détail d'un rendez-vous de la frise, au centre de l'écran. La carte naît du jalon cliqué
 * (elle glisse vers le centre en grossissant, avec un léger dépassement) et y retourne en se
 * refermant ; les lignes s'y posent en cascade. Le mémo garde les infos à retenir.
 */
function MeetingDetail({ meeting, origin, report, dateLabel, onOpenMeeting, openLabel = "Ouvrir le point d'équipe", onClose }: MeetingDetailProps): React.JSX.Element {
  const backdropRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const memoListRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const openRef = useRef<Spring | null>(null)
  const closingRef = useRef(false)
  const freshIds = useRef(new Set<string>())
  const [memos, setMemos] = useState<Memo[]>(() => loadMemos(meeting.label))
  const [draft, setDraft] = useState("")
  const [now] = useState(() => new Date())
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const status = dateLabel
    ? { text: dateLabel, progress: null }
    : describeStatus(meeting, now.getHours() * 60 + now.getMinutes())
  const duration = !dateLabel && meeting.endMinutes !== undefined ? meeting.endMinutes - meeting.startMinutes : null

  const paint = useCallback(
    (p: number): void => {
      const card = cardRef.current
      const backdrop = backdropRef.current
      if (!card || !backdrop) return
      backdrop.style.opacity = String(Math.max(0, Math.min(1, p * 1.4)))
      card.style.opacity = String(Math.max(0, Math.min(1, p * 2.4)))
      // Depuis le jalon : la carte part de sa position, petite, et s'installe au centre.
      const box = card.getBoundingClientRect()
      const centerX = box.left + box.width / 2 - parseFloat(card.dataset.tx ?? "0")
      const centerY = box.top + box.height / 2 - parseFloat(card.dataset.ty ?? "0")
      const fromX = origin ? origin.left + origin.width / 2 - centerX : 0
      const fromY = origin ? origin.top + origin.height / 2 - centerY : 24
      const tx = fromX * (1 - p)
      const ty = fromY * (1 - p)
      card.dataset.tx = String(tx)
      card.dataset.ty = String(ty)
      card.style.translate = p === 1 ? "" : `${tx.toFixed(2)}px ${ty.toFixed(2)}px`
      card.style.scale = p === 1 ? "" : (0.3 + 0.7 * p).toFixed(4)
      if (p === 0 && closingRef.current) onClose()
    },
    [origin, onClose],
  )

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    if (prefersReducedMotion()) {
      paint(1)
    } else {
      paint(0)
      openRef.current = spring(0, 1, OPEN_SPRING, paint)
    }
    playSfx("tick")
    card.focus({ preventScroll: true })
    const rise = Array.from(card.querySelectorAll<HTMLElement>("[data-rise]"))
    stagger(rise, 60, 140)
    return () => openRef.current?.stop()
    // Une seule fois au montage : la carte est recréée à chaque ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Barre d'avancement d'un bloc en cours : se remplit en ressort.
  useEffect(() => {
    const bar = barRef.current
    if (!bar || status.progress === null) return
    const target = status.progress
    if (prefersReducedMotion()) {
      bar.style.width = `${target * 100}%`
      return
    }
    const s = spring(0, target, SPRINGS.gentle, (p) => {
      bar.style.width = `${Math.max(0, p) * 100}%`
    })
    return () => s.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => void (copyTimerRef.current && clearTimeout(copyTimerRef.current)), [])

  const copyLink = (button: HTMLElement): void => {
    if (!meeting.meetingUrl) return
    void navigator.clipboard
      .writeText(meeting.meetingUrl)
      .then(() => {
        setCopied(true)
        playSfx("saved")
        impulse(button, 10)
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
        copyTimerRef.current = setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => undefined)
  }

  const close = useCallback((): void => {
    if (closingRef.current) return
    closingRef.current = true
    playSfx("tick")
    if (prefersReducedMotion() || !openRef.current) {
      onClose()
      return
    }
    openRef.current.retarget(0)
  }, [onClose])

  // Les nouveaux mémos naissent en ressort.
  useLayoutEffect(() => {
    const list = memoListRef.current
    if (!list || freshIds.current.size === 0) return
    for (const id of freshIds.current) {
      const row = list.querySelector<HTMLElement>(`[data-memo-id="${id}"]`)
      if (row) enter(row, 0, -12)
    }
    freshIds.current.clear()
  }, [memos])

  const commit = (next: Memo[]): void => {
    setMemos(next)
    saveMemos(meeting.label, next)
  }

  const addMemo = (): void => {
    const memo = newMemo(draft)
    if (!memo) {
      // Rien à noter : le champ se secoue au lieu de se taire.
      const input = inputRef.current
      if (input && !prefersReducedMotion()) {
        let x = 0
        spring(0, 0, { stiffness: 600, damping: 12, precision: 50 }, (v) => {
          x = v
          input.style.translate = Math.abs(x) < 0.05 ? "" : `${x.toFixed(2)}px 0`
        }).kick(260)
      }
      return
    }
    playSfx("saved")
    freshIds.current.add(memo.id)
    commit([memo, ...memos])
    setDraft("")
  }

  const toggleImportant = (memo: Memo, button: HTMLElement): void => {
    commit(memos.map((m) => (m.id === memo.id ? { ...m, important: !m.important } : m)))
    playSfx(memo.important ? "tick" : "ping")
    impulse(button, memo.important ? -6 : 18)
  }

  const removeMemo = (memo: Memo): void => {
    const row = memoListRef.current?.querySelector<HTMLElement>(`[data-memo-id="${memo.id}"]`)
    if (!row) {
      commit(memos.filter((m) => m.id !== memo.id))
      return
    }
    playSfx("undo")
    flick(row, 1)
    void collapse(row).then(() => commit(memos.filter((m) => m.id !== memo.id)))
  }

  // Les présents du compte rendu (figés à l'enregistrement), sinon ceux de l'invitation du jour.
  const people = report?.attendees ?? meeting.attendees ?? []
  const decisions = report?.items.filter((item) => item.type === "decision") ?? []
  const tasks = report?.items.filter((item) => item.type === "task") ?? []
  const tickets = tasks.filter((item) => item.jiraKey).length
  // Pull requests, maquettes et releases reliées aux tickets de la réunion (docs/ipc/ticket-links.md).
  const { links, setLinks } = useTicketLinks()
  const sorted = sortMemos(memos)
  const importantCount = memos.filter((m) => m.important).length

  return (
    <div className="meeting-detail" role="presentation">
      <div ref={backdropRef} className="meeting-detail-backdrop" onClick={close} />
      <div
        ref={cardRef}
        className="meeting-detail-card"
        role="dialog"
        aria-modal="true"
        aria-label={meeting.label}
        tabIndex={-1}
        onKeyDown={(event) => {
          // Les raccourcis de l'écran (Espace, T…) ne doivent pas s'activer derrière la carte.
          event.stopPropagation()
          if (event.key === "Escape") close()
        }}
      >
        <div className="meeting-detail-head" data-rise>
          <div className="meeting-detail-heading">
            <span className="meeting-detail-kicker">{status.text}</span>
            <h2 className="meeting-detail-title">{meeting.label}</h2>
            {!dateLabel && (
              <span className="meeting-detail-when">
                {formatMinutes(meeting.startMinutes)}
                {meeting.endMinutes !== undefined && `–${formatMinutes(meeting.endMinutes)}`}
                {duration !== null && ` · ${formatDuration(duration)}`}
              </span>
            )}
          </div>
          <button type="button" className="meeting-detail-close" aria-label="Fermer" onClick={close}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {(meeting.location || meeting.meetingUrl) && (
          <div className="meeting-detail-where" data-rise>
            {meeting.location && (
              <div className="meeting-detail-where-row">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="meeting-detail-where-text">{meeting.location}</span>
              </div>
            )}
            {meeting.meetingUrl && (
              <div className="meeting-detail-where-row">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m16 13 5.2 3.1a.5.5 0 0 0 .8-.4V8.3a.5.5 0 0 0-.8-.4L16 11" />
                  <rect x="2" y="6" width="14" height="12" rx="2" />
                </svg>
                <span className="meeting-detail-where-text">{providerOf(meeting.meetingUrl)}</span>
                <a className="meeting-detail-join" href={meeting.meetingUrl} target="_blank" rel="noreferrer">
                  Rejoindre
                </a>
                <button type="button" className="meeting-detail-copy" onClick={(event) => copyLink(event.currentTarget)}>
                  {copied ? "Copié" : "Copier le lien"}
                </button>
              </div>
            )}
          </div>
        )}

        {status.progress !== null && (
          <div className="meeting-detail-progress" data-rise aria-hidden="true">
            <div ref={barRef} className="meeting-detail-progress-fill" />
          </div>
        )}

        {people.length > 0 && (
          <div className="meeting-detail-people" data-rise>
            <span className="meeting-detail-group-title">
              {people.length} {people.length > 1 ? "présents" : "présent"}
            </span>
            <PeopleChips people={people} />
          </div>
        )}

        {onOpenMeeting && (
          <button type="button" className="meeting-detail-primary" data-rise onClick={onOpenMeeting}>
            {openLabel}
          </button>
        )}

        {report && (
          <section className="meeting-detail-report" aria-label="Compte rendu">
            <div className="meeting-detail-section-head" data-rise>
              <span className="meeting-detail-section-title">Compte rendu</span>
              <span className={`meeting-detail-badge meeting-detail-badge--${report.status}`}>
                {report.status === "recording" ? "Enregistrement" : report.status === "sent" ? "Envoyé à l'équipe" : "Prêt"}
              </span>
            </div>
            {report.summary && (
              <p className="meeting-detail-summary" data-rise>
                <PersonText text={report.summary} people={people} />
              </p>
            )}
            {decisions.length > 0 && (
              <div className="meeting-detail-group" data-rise>
                <span className="meeting-detail-group-title">
                  {decisions.length} {decisions.length > 1 ? "décisions" : "décision"}
                </span>
                <ul className="meeting-detail-items">
                  {decisions.map((item, i) => (
                    <li key={i} className="meeting-detail-item" data-type="decision">
                      <span className="meeting-detail-item-dot" aria-hidden="true" />
                      <span className="meeting-detail-item-text">
                        <PersonText text={item.text} people={people} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tasks.length > 0 && (
              <div className="meeting-detail-group" data-rise>
                <span className="meeting-detail-group-title">
                  {tasks.length} {tasks.length > 1 ? "tâches" : "tâche"}
                  {tickets > 0 && ` · ${tickets} ${tickets > 1 ? "tickets créés" : "ticket créé"}`}
                </span>
                <ul className="meeting-detail-items">
                  {tasks.map((item, i) => {
                    const linked = item.jiraKey
                      ? links?.tickets.find((ticket) => ticket.issueKey === item.jiraKey)
                      : undefined
                    return (
                      <li key={i} className="meeting-detail-item" data-type="task">
                        <span className="meeting-detail-item-dot" aria-hidden="true" />
                        <span className="meeting-detail-item-text">
                          <PersonText text={item.text} people={people} />
                          {linked && <TicketLinkChips ticket={linked} onChange={setLinks} />}
                        </span>
                        {item.jiraKey &&
                          (item.jiraUrl ? (
                            <a className="meeting-detail-ticket" href={item.jiraUrl} target="_blank" rel="noreferrer">
                              {item.jiraKey}
                            </a>
                          ) : (
                            <span className="meeting-detail-ticket">{item.jiraKey}</span>
                          ))}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="meeting-detail-memo" aria-label="Mémo">
          <div className="meeting-detail-memo-head" data-rise>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              <path d="M8 13h8" />
              <path d="M8 17h5" />
            </svg>
            <span className="meeting-detail-memo-title">Mémo</span>
            {memos.length > 0 && (
              <span className="meeting-detail-memo-count">
                {memos.length}
                {importantCount > 0 && ` · ${importantCount} à retenir`}
              </span>
            )}
          </div>

          <div className="meeting-detail-memo-add" data-rise>
            <input
              ref={inputRef}
              className="meeting-detail-input"
              type="text"
              value={draft}
              maxLength={280}
              placeholder="Noter une info importante…"
              aria-label="Nouvelle note"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  addMemo()
                }
              }}
            />
            <button type="button" className="meeting-detail-add" onClick={addMemo}>
              Ajouter
            </button>
          </div>

          <div ref={memoListRef} className="meeting-detail-memo-list">
            {sorted.length === 0 && (
              <p className="meeting-detail-empty" data-rise>
                Rien à retenir pour l&apos;instant. Ce que vous notez ici reste attaché à « {meeting.label} ».
              </p>
            )}
            {sorted.map((memo) => (
              <div
                key={memo.id}
                data-memo-id={memo.id}
                className={`meeting-detail-memo-row${memo.important ? " meeting-detail-memo-row--important" : ""}`}
              >
                <button
                  type="button"
                  className="meeting-detail-star"
                  aria-pressed={memo.important}
                  aria-label={memo.important ? "Ne plus marquer comme important" : "Marquer comme important"}
                  onClick={(event) => toggleImportant(memo, event.currentTarget)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
                  </svg>
                </button>
                <span className="meeting-detail-memo-text">{memo.text}</span>
                <button type="button" className="meeting-detail-remove" aria-label="Supprimer la note" onClick={() => removeMemo(memo)}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default MeetingDetail
