import { useEffect, useState } from "react"
import DayTimeline from "./DayTimeline"
import type { Milestone } from "./DayTimeline"
import TalkToBcc from "./TalkToBcc"
import { SpeakerIcon, SpeakerOffIcon, GearIcon } from "./icons"
import { useSound } from "@renderer/lib/useSound"
import type { CalendarEventSummary } from "@shared/googleCalendar"
import "./dayview.css"

interface DayViewProps {
  calendarEvents: CalendarEventSummary[] | null
  onOpenJournal: () => void
  onOpenSettings: () => void
  onOpenPointDEquipe: () => void
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
}

function isoToMinutes(iso: string): number {
  const date = new Date(iso)
  return date.getHours() * 60 + date.getMinutes()
}

/** Insensible à la casse/accents : couvre "Point d'équipe", "point d'équipe hebdo", etc. */
function isPointDEquipe(label: string): boolean {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .includes("point d'equipe")
}

/**
 * Vue journée (tickets B1 timeline + B2 état par défaut + B4 « Parler à
 * BCC »), fidèle au prototype. Le nombre de tickets vient de Jira (E1,
 * `jira:countOpenIssues`) et la frise (B1) des vrais événements Google
 * Agenda (E4) une fois connecté — sinon `DayTimeline` retombe sur ses jalons
 * statiques. `calendarEvents` est récupéré et tenu à jour par `App` (pas ici)
 * car il sert aussi à basculer automatiquement vers « Point d'équipe » quand
 * une réunion commence, ce qui doit survivre au démontage de cet écran.
 * « fils Slack » reste le texte du prototype tant qu'E3 n'est pas câblé.
 * Aucun popover de notification n'est affiché pour la même raison.
 */
function DayView({ calendarEvents, onOpenJournal, onOpenSettings, onOpenPointDEquipe }: DayViewProps): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const { muted, ready: soundReady, toggleMute } = useSound()

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    window.api.jira.countOpenIssues().then(setTicketCount).catch(() => setTicketCount(null))
  }, [])

  const milestones: Milestone[] | undefined = calendarEvents
    ?.filter((event) => !event.allDay)
    .map((event) => ({
      label: event.title,
      startMinutes: isoToMinutes(event.start),
      endMinutes: event.end ? isoToMinutes(event.end) : undefined,
    }))

  const hour = now.getHours()
  const statusLabel = hour < 12 ? "Silence" : hour < 17 ? "Focus" : "Silence"

  return (
    <div className="dayview-screen">
      <div className="dayview-header">
        <div className="dayview-header-left">
          <span className="dayview-header-time">{formatTime(now)}</span>
          <span>·</span>
          <span>{statusLabel}</span>
        </div>
        <div className="dayview-header-right">
          {!muted && !soundReady && (
            <span className="dayview-audio-hint">Touchez l&apos;écran pour activer le son</span>
          )}
          <button type="button" className="dayview-journal-button" onClick={onOpenJournal}>
            Journal
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
          <button type="button" className="dayview-icon-button" aria-label="Réglages" onClick={onOpenSettings}>
            <GearIcon />
          </button>
        </div>
      </div>

      <DayTimeline
        milestones={milestones}
        onSelectMilestone={(label) => {
          if (isPointDEquipe(label)) onOpenPointDEquipe()
        }}
      />

      <div className="dayview-body">
        <h1 className="dayview-title">Rien ne dépend de vous.</h1>
        <p className="dayview-subtitle">
          Je veille sur {ticketCount === null ? "vos" : ticketCount} tickets, 3 fils Slack et votre agenda.
        </p>

        <TalkToBcc />
      </div>
    </div>
  )
}

export default DayView
