import { useCallback, useEffect, useState } from "react"
import DayTimeline from "./DayTimeline"
import ProfileMenu from "../profile/ProfileMenu"
import type { Milestone } from "./DayTimeline"
import MeetingDetail from "./MeetingDetail"
import TalkToBcc from "./TalkToBcc"
import { SpeakerIcon, SpeakerOffIcon } from "./icons"
import { loadTodayReport } from "@renderer/lib/meetingReports"
import { isPointDEquipe } from "@renderer/lib/pointMeeting"
import type { StoredMeetingReport } from "@renderer/lib/meetingReports"
import { useSound } from "@renderer/lib/useSound"
import { useDigest } from "@renderer/lib/useDigest"
import type { CalendarEventSummary } from "@shared/googleCalendar"
import "./dayview.css"

interface DayViewProps {
  calendarEvents: CalendarEventSummary[] | null
  onOpenJournal: () => void
  onOpenMemory: () => void
  /** Décisions de réunion pas encore consignées : affichées en pastille sur le bouton Mémoire. */
  memoryProposals?: number
  onOpenSettings: () => void
  /** `eventId` : l'invitation visée ; `autoStart` : lancer l'enregistrement dès l'arrivée (réunion déjà commencée). */
  onOpenPointDEquipe: (options?: { eventId?: string; autoStart?: boolean }) => void
  /** Une autre fenêtre modale (Réglages) est ouverte par-dessus : l'écran est inerte. */
  blocked?: boolean
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
}

/** Le rendez-vous est en cours : on peut y lancer l'enregistrement, même en retard. */
function isInProgress(milestone: Milestone, now: Date): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return milestone.endMinutes !== undefined && minutes >= milestone.startMinutes && minutes < milestone.endMinutes
}

function isoToMinutes(iso: string): number {
  const date = new Date(iso)
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Vue journée (tickets B1 timeline + B2 état par défaut + B4 « Parler à
 * BCC »), fidèle au prototype. Le nombre de tickets vient de Jira (E1,
 * `jira:countOpenIssues`) et la frise (B1) des vrais événements Google
 * Agenda (E4) une fois connecté — sinon la frise n'est qu'une simple ligne, sans faux jalons. `calendarEvents` est récupéré et tenu à jour par `App` (pas ici)
 * car il sert aussi à basculer automatiquement vers « Point d'équipe » quand
 * une réunion commence, ce qui doit survivre au démontage de cet écran.
 * Le sous-titre ne cite que ce qui est réellement surveillé (tickets, agenda s'il est connecté).
 * Aucun popover de notification n'est affiché pour la même raison.
 */
function DayView({
  calendarEvents,
  onOpenJournal,
  onOpenMemory,
  memoryProposals = 0,
  onOpenSettings,
  onOpenPointDEquipe,
  blocked = false,
}: DayViewProps): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [selected, setSelected] = useState<{
    milestone: Milestone
    origin: DOMRect
    report: StoredMeetingReport | null
  } | null>(null)
  const closeDetail = useCallback(() => setSelected(null), [])
  const { muted, ready: soundReady, toggleMute } = useSound()
  // Les points à regarder aujourd'hui, choisis selon le rôle ; tant qu'il n'y en a aucun, l'écran reste celui du prototype.
  const attention = useDigest()?.items ?? []

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    window.api.jira
      .countOpenIssues()
      .then(setTicketCount)
      .catch(() => setTicketCount(null))
  }, [])

  const milestones: Milestone[] | undefined = calendarEvents
    ?.filter((event) => !event.allDay)
    .map((event) => ({
      label: event.title,
      startMinutes: isoToMinutes(event.start),
      endMinutes: event.end ? isoToMinutes(event.end) : undefined,
      location: event.location,
      meetingUrl: event.meetingUrl,
      attendees: event.attendees,
      eventId: event.id,
    }))

  // Une fenêtre modale ouverte (carte de détail, Réglages) rend tout l'écran inerte : ni souris, ni clavier,
  // ni lecteur d'écran n'atteignent l'arrière-plan, et la goutte de la frise se met en pause.
  const modalOpen = selected !== null || blocked

  return (
    <>
      <div className="dayview-screen" inert={modalOpen}>
        <div className="dayview-header">
          <div className="dayview-header-left">
            <span className="dayview-header-time">{formatTime(now)}</span>
          </div>
          <div className="dayview-header-right">
            {!muted && !soundReady && (
              <span className="dayview-audio-hint">Touchez l&apos;écran pour activer le son</span>
            )}
            <button type="button" className="dayview-journal-button" onClick={onOpenJournal}>
              Journal
            </button>
            <button type="button" className="dayview-journal-button" onClick={onOpenMemory}>
              Mémoire
              {memoryProposals > 0 && (
                <span className="dayview-memory-badge" aria-label={`${memoryProposals} décision${memoryProposals > 1 ? "s" : ""} à consigner`}>
                  {memoryProposals}
                </span>
              )}
            </button>
            <button
              type="button"
              className="dayview-icon-button"
              aria-label={muted ? "Activer le son" : "Couper le son"}
              title={muted ? "Activer le son" : "Couper le son"}
              onClick={toggleMute}
            >
              {muted ? <SpeakerOffIcon /> : <SpeakerIcon />}
            </button>
            <ProfileMenu onOpenSettings={onOpenSettings} />
          </div>
        </div>

        <DayTimeline
          milestones={milestones}
          onSelectMilestone={(milestone, origin) =>
            setSelected({
              milestone,
              origin,
              report: isPointDEquipe(milestone.label) ? loadTodayReport() : null,
            })
          }
          paused={modalOpen}
        />

        <div className="dayview-body">
          <h1 className="dayview-title">
            {attention.length === 0
              ? "Rien ne dépend de vous."
              : attention.length === 1
                ? "Un point à regarder."
                : `${attention.length} points à regarder.`}
          </h1>
          <p className="dayview-subtitle">
            Je veille sur {ticketCount === null ? "vos tickets" : `${ticketCount} ticket${ticketCount > 1 ? "s" : ""}`}
            {calendarEvents !== null ? " et votre agenda" : ""}.
          </p>

          {attention.length > 0 && (
            <ul className="dayview-digest" aria-label="Points à regarder">
              {attention.map((item) => {
                const inner = (
                  <>
                    <span className="dayview-digest-text">
                      {item.text}
                      {item.detail && <span className="dayview-digest-detail">{item.detail}</span>}
                    </span>
                    <span className="dayview-digest-chevron" aria-hidden="true">
                      {item.url ? "↗" : "›"}
                    </span>
                  </>
                )
                return (
                  <li key={item.id}>
                    {item.url ? (
                      <a className="dayview-digest-item" href={item.url} target="_blank" rel="noreferrer">
                        {inner}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="dayview-digest-item"
                        onClick={item.target === "memory" ? onOpenMemory : onOpenJournal}
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <TalkToBcc />
        </div>
      </div>

      {selected && (
        <MeetingDetail
          meeting={selected.milestone}
          origin={selected.origin}
          report={selected.report}
          openLabel={selected.report ? "Ouvrir le point d'équipe" : "🎙 Démarrer l'enregistrement"}
          onOpenMeeting={
            isPointDEquipe(selected.milestone.label) || isInProgress(selected.milestone, now)
              ? () => onOpenPointDEquipe({ eventId: selected.milestone.eventId, autoStart: !selected.report })
              : undefined
          }
          onClose={closeDetail}
        />
      )}
    </>
  )
}

export default DayView
