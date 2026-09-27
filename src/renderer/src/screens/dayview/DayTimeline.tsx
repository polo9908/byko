import { useEffect, useState } from "react"

export interface Milestone {
  label: string
  /** Heure de début, en minutes depuis minuit. */
  startMinutes: number
  /** Pour un jalon "bloc" (a une durée) ; absent = jalon ponctuel (simple repère). */
  endMinutes?: number
}

/**
 * Jalons de secours (ticket B1) utilisés tant que Google Agenda (E4) n'est
 * pas connecté ou n'a rien à donner. Une fois connecté, `DayView` calcule de
 * vrais jalons depuis `window.api.calendar.listTodayEvents()` et les passe
 * via la prop `milestones` — le repère de position courante, lui, a toujours
 * suivi l'heure réelle et n'a pas changé.
 */
const DAY_START_MINUTES = 9 * 60
const DAY_END_MINUTES = 18 * 60 + 30

const FALLBACK_MILESTONES: Milestone[] = [
  { label: "Stand-up", startMinutes: 9 * 60 + 15 },
  { label: "Karim code", startMinutes: 10 * 60 + 30 },
  { label: "Point d'équipe", startMinutes: 13 * 60 + 30, endMinutes: 13 * 60 + 45 },
  { label: "Focus", startMinutes: 15 * 60, endMinutes: 17 * 60 + 30 },
  { label: "Fin", startMinutes: 18 * 60 },
]

function minutesToFraction(minutes: number): number {
  const clamped = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES, minutes))
  return (clamped - DAY_START_MINUTES) / (DAY_END_MINUTES - DAY_START_MINUTES)
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

interface DayTimelineProps {
  /** Jalons réels (Google Agenda). `undefined` = pas encore su / non connecté → repli statique ; `[]` = agenda vide, assumé tel quel. */
  milestones?: Milestone[]
  onSelectMilestone?: (label: string) => void
}

function DayTimeline({ milestones, onSelectMilestone }: DayTimelineProps): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  const items = milestones ?? FALLBACK_MILESTONES

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowFraction = minutesToFraction(nowMinutes)
  const showNowDot = nowMinutes >= DAY_START_MINUTES && nowMinutes <= DAY_END_MINUTES

  return (
    <div className="dayview-timeline">
      <div className="dayview-timeline-track" />
      <div className="dayview-timeline-fill" style={{ width: `${nowFraction * 100}%` }} />
      {showNowDot && <div className="dayview-timeline-now" style={{ left: `${nowFraction * 100}%` }} />}
      {items.map((milestone) => {
        const startFraction = minutesToFraction(milestone.startMinutes)
        if (milestone.endMinutes !== undefined) {
          const endFraction = minutesToFraction(milestone.endMinutes)
          // Centré sur le milieu du bloc (pas son début) pour que le libellé ne chevauche pas ses voisins.
          const midFraction = (startFraction + endFraction) / 2
          return (
            <button
              key={`${milestone.label}-${milestone.startMinutes}`}
              type="button"
              className="dayview-timeline-milestone"
              style={{ left: `${midFraction * 100}%` }}
              onClick={() => onSelectMilestone?.(milestone.label)}
            >
              <span
                className="dayview-timeline-block"
                style={{ width: `${Math.max(1, (endFraction - startFraction) * 100)}%` }}
              />
              <span className="dayview-timeline-label">{milestone.label}</span>
              <span className="dayview-timeline-time">
                {formatMinutes(milestone.startMinutes)}–{formatMinutes(milestone.endMinutes)}
              </span>
            </button>
          )
        }
        return (
          <button
            key={`${milestone.label}-${milestone.startMinutes}`}
            type="button"
            className="dayview-timeline-milestone"
            style={{ left: `${startFraction * 100}%` }}
            onClick={() => onSelectMilestone?.(milestone.label)}
          >
            <span className="dayview-timeline-tick" />
            <span className="dayview-timeline-label">{milestone.label}</span>
            <span className="dayview-timeline-time">{formatMinutes(milestone.startMinutes)}</span>
          </button>
        )
      })}
    </div>
  )
}

export default DayTimeline
