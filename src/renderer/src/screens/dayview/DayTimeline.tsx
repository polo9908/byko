import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { prefersReducedMotion, spring, SPRINGS } from "@renderer/lib/motion"
import type { Spring } from "@renderer/lib/motion"
import { createWaterDrop } from "@renderer/lib/waterDrop"
import type { WaterDrop } from "@renderer/lib/waterDrop"
import { playSfx } from "@renderer/lib/sound"

export interface Milestone {
  label: string
  /** Heure de début, en minutes depuis minuit. */
  startMinutes: number
  /** Pour un jalon "bloc" (a une durée) ; absent = jalon ponctuel (simple repère). */
  endMinutes?: number
  /** Lieu (texte) et lien de visio de l'invitation Google Agenda, si elle en a. */
  location?: string
  meetingUrl?: string
  /** Identifiant de l'événement Google Agenda : retrouve l'invitation (lien, présents) pour l'enregistrement. */
  eventId?: string
  /** Présents d'après l'invitation (noms). */
  attendees?: string[]
}

/** Plage par défaut de la journée ; elle s'élargit si l'agenda a des événements plus tôt ou plus tard. */
const DEFAULT_START_MINUTES = 9 * 60
const DEFAULT_END_MINUTES = 18 * 60 + 30

interface DayRange {
  start: number
  end: number
}

/** Heures pleines englobant tous les événements du jour, jamais plus étroites que la plage par défaut. */
function dayRange(items: Milestone[]): DayRange {
  let start = DEFAULT_START_MINUTES
  let end = DEFAULT_END_MINUTES
  for (const item of items) {
    start = Math.min(start, Math.floor(Math.max(0, item.startMinutes) / 60) * 60)
    end = Math.max(end, Math.ceil(Math.min(24 * 60, item.endMinutes ?? item.startMinutes) / 60) * 60)
  }
  return { start, end }
}

function minutesToFraction(minutes: number, range: DayRange): number {
  const clamped = Math.max(range.start, Math.min(range.end, minutes))
  return (clamped - range.start) / (range.end - range.start)
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
  /** Jalons réels (Google Agenda). `undefined` ou `[]` : rien à montrer, la frise n'est alors qu'une simple ligne (jamais de faux jalons). */
  milestones?: Milestone[]
  /** `origin` : rectangle du repère cliqué (la carte de détail en naît). */
  onSelectMilestone?: (milestone: Milestone, origin: DOMRect) => void
  /** Une fenêtre modale est ouverte : la goutte (et ses sons) se met en pause. */
  paused?: boolean
}

/**
 * Frise de la journée. Survoler un jalon y fait naître une goutte d'eau « verre liquide »
 * qui grossit ses informations (voir `lib/waterDrop.ts`) ; la progression et le repère
 * « maintenant » avancent en ressort.
 */
/** Rectangle du repère visible (bloc ou tick) d'un jalon, plus parlant que celui du bouton entier. */
function markRect(button: HTMLElement): DOMRect {
  return (button.querySelector(".dayview-timeline-block, .dayview-timeline-tick") ?? button).getBoundingClientRect()
}

function DayTimeline({ milestones, onSelectMilestone, paused = false }: DayTimelineProps): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  const items = useMemo(() => milestones ?? [], [milestones])
  const range = useMemo(() => dayRange(items), [items])
  const timelineRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const nowDotRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<WaterDrop | null>(null)
  const progressRef = useRef<Spring | null>(null)

  useEffect(() => {
    const timeline = timelineRef.current
    const canvas = canvasRef.current
    if (!timeline || !canvas) return
    const drop = createWaterDrop(timeline, canvas, (event) =>
      playSfx(event === "birth" ? "liquidBirth" : event === "split" ? "liquidSplit" : "liquidMove"),
    )
    dropRef.current = drop
    return () => {
      drop?.destroy()
      dropRef.current = null
    }
  }, [])

  // Les jalons réels (Google Agenda) changent au fil des rafraîchissements : la goutte relit leurs horaires.
  useEffect(() => {
    dropRef.current?.setPaused(paused)
  }, [paused])

  useEffect(() => {
    dropRef.current?.setMilestones(items.map((m) => ({ startMinutes: m.startMinutes, endMinutes: m.endMinutes })))
  }, [items])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowFraction = minutesToFraction(nowMinutes, range)
  const showNowDot = nowMinutes >= range.start && nowMinutes <= range.end

  // La progression et le point « maintenant » glissent en ressort à chaque minute, au lieu de sauter.
  useLayoutEffect(() => {
    const paint = (fraction: number): void => {
      if (fillRef.current) fillRef.current.style.width = `${fraction * 100}%`
      if (nowDotRef.current) nowDotRef.current.style.left = `${fraction * 100}%`
    }
    if (!progressRef.current) {
      paint(nowFraction)
      progressRef.current = spring(nowFraction, nowFraction, SPRINGS.gentle, paint)
      return
    }
    if (prefersReducedMotion()) progressRef.current.set(nowFraction)
    progressRef.current.retarget(nowFraction)
  }, [nowFraction, showNowDot])

  return (
    <div className="dayview-timeline" ref={timelineRef}>
      <div className="dayview-timeline-track" />
      <div className="dayview-timeline-fill" ref={fillRef} />
      {showNowDot && <div className="dayview-timeline-now" ref={nowDotRef} />}
      {items.map((milestone) => {
        const startFraction = minutesToFraction(milestone.startMinutes, range)
        if (milestone.endMinutes !== undefined) {
          const endFraction = minutesToFraction(milestone.endMinutes, range)
          // Centré sur le milieu du bloc (pas son début) pour que le libellé ne chevauche pas ses voisins.
          const midFraction = (startFraction + endFraction) / 2
          return (
            <button
              key={`${milestone.label}-${milestone.startMinutes}`}
              type="button"
              className="dayview-timeline-milestone"
              style={{ left: `${midFraction * 100}%` }}
              onClick={(event) => onSelectMilestone?.(milestone, markRect(event.currentTarget))}
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
            onClick={(event) => onSelectMilestone?.(milestone, markRect(event.currentTarget))}
          >
            <span className="dayview-timeline-tick" />
            <span className="dayview-timeline-label">{milestone.label}</span>
            <span className="dayview-timeline-time">{formatMinutes(milestone.startMinutes)}</span>
          </button>
        )
      })}
      <canvas ref={canvasRef} className="dayview-timeline-drop" aria-hidden="true" />
    </div>
  )
}

export default DayTimeline
