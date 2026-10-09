import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { isSilent, startLiveVoiceRecording } from "@renderer/lib/voiceRecorder"
import type { LiveVoiceRecording } from "@renderer/lib/voiceRecorder"
import { playSfx } from "@renderer/lib/sound"
import {
  bouncers,
  collapse,
  drop,
  dropIn,
  enter,
  flick,
  fling,
  flingAwayCopy,
  flyTo,
  heartbeat,
  impulse,
  morphFromRect,
  pop,
  prefersReducedMotion,
  scaleSpring,
  spring,
  stagger,
  tick,
  wait,
} from "@renderer/lib/motion"
import { useFlip } from "@renderer/lib/useMotion"
import { MEETING_ITEM_MAX_CHARS, MEETING_REPORT_MAX_ITEMS } from "@shared/meeting"
import type { MeetingItemDraft, MeetingItemType, MeetingRemovalReason } from "@shared/meeting"
import { JiraChip, Odometer, SendButton, TypedText, WaveBars, WrittenText } from "./MeetingMotion"
import type { SendState } from "./MeetingMotion"
import { appendSegment } from "@renderer/lib/transcript"
import { saveTodayReport } from "@renderer/lib/meetingReports"
import type { StoredMeetingItem } from "@renderer/lib/meetingReports"
import type { CalendarEventSummary } from "@shared/googleCalendar"
import { firstName } from "@renderer/lib/people"
import { PeopleChips, PersonText } from "./People"
import "../onboarding/onboarding.css"
import "./pointdequipe.css"

type Phase = "idle" | "recording" | "summarizing" | "done" | "sent" | "error"

/** Segment de transcription "en direct" (voir `startLiveVoiceRecording`) : ni trop réactif, ni trop lent à l'appel IA. */
const SEGMENT_MS = 8000
/** Recouvrement entre deux segments : un mot à la jointure n'est plus coupé (voir `startLiveVoiceRecording`). */
const OVERLAP_MS = 2000
const TYPE_INTERVAL_MS = 28
const WAVE_BARS = 24
/** Durée de la sortie d'un item retiré (trait barré, pichenette, liste qui se referme) avant de le retirer de l'état. */
const LEAVE_MS = 1600

interface MeetingItem {
  id: string
  type: MeetingItemType
  text: string
  typedChars: number
  /** La réunion est revenue dessus : l'item joue sa sortie et n'existe plus pour la logique. */
  leaving?: boolean
  jiraStatus?: "saving" | "saved" | "error"
  jiraKey?: string
  jiraUrl?: string
  jiraError?: string
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0")
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0")
  return `${m}:${s}`
}

/** `ipcRenderer.invoke` préfixe tout rejet avec "Error invoking remote method '<canal>': " : on l'enlève pour l'UI. */
function cleanIpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

function TicketIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </svg>
  )
}

interface ItemRowProps {
  item: MeetingItem
  editable: boolean
  editing: boolean
  enterDelay?: number
  onStartEdit: () => void
  onCommitEdit: (text: string) => void
  onCancelEdit: () => void
  people?: string[]
}

/**
 * Une décision/tâche : elle entre en glissant, son point éclot, son texte s'écrit lettre à
 * lettre. Quand la réunion revient dessus, un trait la barre, puis elle part d'une pichenette et
 * la liste se referme en ressort.
 */
function ItemRow({
  item,
  editable,
  editing,
  enterDelay = 0,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  people = [],
}: ItemRowProps): React.JSX.Element {
  const ref = useRef<HTMLLIElement>(null)
  const delayRef = useRef(enterDelay)

  useLayoutEffect(() => {
    const li = ref.current
    if (!li) return
    enter(li, delayRef.current, 10)
    const dot = li.querySelector<HTMLElement>(".pointdequipe-item-dot")
    if (dot) pop(dot, delayRef.current + 40, 0)
  }, [])

  useLayoutEffect(() => {
    const li = ref.current
    if (!item.leaving || !li) return
    const text = li.querySelector<HTMLElement>(".pointdequipe-item-text")
    if (text) {
      const letters = text.querySelectorAll<HTMLElement>("[data-i]")
      const last = letters[letters.length - 1]
      const strike = document.createElement("span")
      strike.className = "pointdequipe-strike"
      strike.style.width = `${last ? last.offsetLeft + last.offsetWidth : text.offsetWidth}px`
      text.appendChild(strike)
      if (prefersReducedMotion()) strike.style.scale = "1 1"
      else spring(0, 1, { stiffness: 190, damping: 21 }, (p) => (strike.style.scale = `${Math.max(0, p).toFixed(4)} 1`))
    }
    const timer = setTimeout(() => {
      flick(li, 1)
      void collapse(li)
    }, 700)
    return () => clearTimeout(timer)
  }, [item.leaving])

  const typed = item.typedChars >= item.text.length
  const chipStatus = item.leaving ? "removed" : (item.jiraStatus ?? "saving")
  return (
    <li ref={ref} className="pointdequipe-item" data-type={item.type} data-flip-key={item.id} data-item-id={item.id}>
      <span className="pointdequipe-item-dot" aria-hidden="true" />
      {editing ? (
        <input
          className="pointdequipe-item-edit-input"
          defaultValue={item.text}
          maxLength={MEETING_ITEM_MAX_CHARS}
          autoFocus
          onBlur={(event) => onCommitEdit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
            if (event.key === "Escape") onCancelEdit()
          }}
        />
      ) : (
        <TypedText text={item.text} typedChars={item.typedChars} people={people} />
      )}
      {editable && !editing && typed && (
        <button type="button" className="pointdequipe-item-edit-button" aria-label="Corriger" onClick={onStartEdit}>
          ✎
        </button>
      )}
      {item.type === "task" && typed && (
        <JiraChip status={chipStatus} jiraKey={item.jiraKey} url={item.jiraUrl} error={item.jiraError} />
      )}
    </li>
  )
}

interface PointDEquipeViewProps {
  onBack: () => void
  /** L'invitation Google Agenda de ce point : lien de visio et présents (absente si l'agenda n'est pas connecté). */
  meeting?: CalendarEventSummary
  /** Réunion déjà commencée (ouverte depuis sa carte) : l'enregistrement démarre dès l'arrivée. */
  autoStart?: boolean
}

/**
 * Mode « Point d'équipe » (ticket B3). Capture micro réelle (getUserMedia),
 * visualisation d'onde à partir de l'amplitude réelle du signal, transcription
 * "en direct" par segments successifs (Whisper local, voir `voiceRecorder.ts`
 * et `main/speech.ts` — pas de vrai streaming, mais un nouveau segment toutes
 * les `SEGMENT_MS`). Chaque segment est envoyé à l'IA pour en extraire les
 * décisions/tâches nouvelles — rien n'est affiché tant que l'IA ne l'a pas
 * identifié dans ce qui a été réellement dit, et les tickets créés sont de
 * vrais tickets Jira (voir `jira.createIssue`).
 *
 * Mouvement (porté du prototype d'étude, voir `lib/motion.ts` et `MeetingMotion.tsx`) : le bouton
 * se déforme en carte d'enregistrement, le point « en direct » bat au rythme de la voix, l'onde
 * est une chaîne de ressorts, le chronomètre roule, les items s'écrivent lettre à lettre et la
 * liste se réagence en ressort, chaque ticket créé s'envole jusqu'au compteur de la carte, l'arrêt
 * fait tomber les lignes, le compte rendu s'écrit mot à mot et l'envoi lance le rapport.
 *
 * Aucun fichier audio n'est jamais écrit sur disque : le flux micro n'existe
 * qu'en mémoire et est coupé à l'arrêt.
 */
function PointDEquipeView({ onBack, meeting, autoStart = false }: PointDEquipeViewProps): React.JSX.Element {
  const people = meeting?.attendees ?? []
  const peopleRef = useRef(people)
  peopleRef.current = people
  const [phase, setPhase] = useState<Phase>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [items, setItems] = useState<MeetingItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [summary, setSummary] = useState("")
  const [summaryWritten, setSummaryWritten] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendState, setSendState] = useState<SendState>("idle")
  const [itemLimitReached, setItemLimitReached] = useState(false)
  const [trayShown, setTrayShown] = useState(false)
  const [trayCount, setTrayCount] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const idleRef = useRef<HTMLDivElement>(null)
  const recordButtonRef = useRef<HTMLButtonElement>(null)
  const trayRef = useRef<HTMLSpanElement>(null)
  const morphFromRef = useRef<{ button: DOMRect; dot: DOMRect } | null>(null)
  const mountedRef = useRef(false)
  const stoppingRef = useRef(false)
  /** Tâches dont le ticket a déjà pris son envol / s'est posé sur le compteur de la carte. */
  const flownIdsRef = useRef<Set<string>>(new Set())
  const landedIdsRef = useRef<Set<string>>(new Set())
  const removalTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelsRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveRecordingRef = useRef<LiveVoiceRecording | null>(null)
  const fullTranscriptRef = useRef("")
  const itemsRef = useRef<MeetingItem[]>([])
  const segmentChainRef = useRef<Promise<void>>(Promise.resolve())
  const nextItemIdRef = useRef(0)
  const typeIntervalsRef = useRef<ReturnType<typeof setInterval>[]>([])
  /** Décision annulée avant que son ticket Jira n'ait fini d'être créé : à supprimer dès que la clé sera connue. */
  const pendingRemovalIdsRef = useRef<Set<string>>(new Set())
  /** Textes explicitement annulés : sans ça, l'IA peut les re-proposer comme "nouveaux" au segment suivant, le transcript complet les contenant toujours. */
  const rejectedTextsRef = useRef<string[]>([])
  /** Identifiant du compte rendu, fixé au démarrage : main s'en sert pour ne pas persister deux fois le même lot au « Réessayer ». */
  const reportIdRef = useRef("")
  /** Garde synchrone : l'état `sending` ne suffit pas contre deux clics traités avant le rendu suivant. */
  const sendingRef = useRef(false)
  /** Ids des items présents, tenus à jour de façon synchrone : `itemsRef` n'est rafraîchi qu'après rendu, trop tard pour borner un lot d'additions. */
  const liveItemIdsRef = useRef<Set<string>>(new Set())

  useFlip(rootRef)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    mountedRef.current = true
    const removalTimers = removalTimersRef.current
    return () => {
      mountedRef.current = false
      removalTimers.forEach(clearTimeout)
      cleanup()
    }
  }, [])

  /** Niveaux du micro (une lecture par appel), partagés par l'onde et le point « en direct ». */
  function readLevels(): Uint8Array | null {
    const analyser = analyserRef.current
    const levels = levelsRef.current
    if (!analyser || !levels) return null
    analyser.getByteFrequencyData(levels)
    return levels
  }

  // Mouvement propre à chaque écran de la réunion, joué à son arrivée.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const all = (selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector))
    const one = (selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector)

    if (phase === "idle") {
      stagger(all(".pointdequipe-eyebrow, .pointdequipe-title, .pointdequipe-subtitle"), 60)
      const button = recordButtonRef.current
      if (button) pop(button, 180, 0.4)
      stagger(all(".pointdequipe-start-label, .pointdequipe-hint, .pointdequipe-back"), 60, 240)
      // Le point rouge respire : une impulsion douce toutes les 2,4 s.
      const dot = one(".pointdequipe-record-dot")
      if (!dot || prefersReducedMotion()) return
      const breath = scaleSpring(dot, { stiffness: 240, damping: 9 })
      let since = 1.6
      return tick((dt) => {
        since += dt
        if (since > 2.4) {
          since = 0
          breath.kick(3.2)
        }
        return !dot.isConnected
      })
    }

    if (phase === "recording") {
      const card = one(".pointdequipe-card")
      const liveDot = card?.querySelector<HTMLElement>(".pointdequipe-live-dot")
      const energy = (): number => {
        const analyser = analyserRef.current
        const levels = levelsRef.current
        if (!analyser || !levels) return 0
        analyser.getByteFrequencyData(levels)
        let sum = 0
        for (let i = 0; i < WAVE_BARS; i++) sum += levels[i] ?? 0
        return (sum / WAVE_BARS / 255) * 0.9
      }
      const stops = all(".pointdequipe-live-dot").map((dot) => heartbeat(dot, dot === liveDot ? energy : undefined))
      const popContent = (): void => {
        if (!card) return
        Array.from(card.children).forEach((child, i) => {
          if (!(child as HTMLElement).classList.contains("pointdequipe-ticket-tray"))
            pop(child as HTMLElement, i * 45, 0.5)
        })
      }
      // Le bouton rond se déforme en carte : chaque dimension a son ressort, la largeur s'étire en dépassant.
      const from = morphFromRef.current
      morphFromRef.current = null
      if (card && liveDot && from && !prefersReducedMotion()) {
        card.style.visibility = "hidden"
        void morphFromRect(from.button, card, {
          radius: 28,
          className: "motion-morph",
          dot: { from: from.dot, to: liveDot, className: "motion-morph-dot" },
        }).then(() => {
          card.style.visibility = ""
          popContent()
        })
      } else {
        popContent()
      }
      return () => stops.forEach((stop) => stop())
    }

    if (phase === "summarizing") {
      enter(one(".pointdequipe-eyebrow") ?? root, 0)
      const title = one(".pointdequipe-title")
      if (title) dropIn(title, 60)
      return bouncers(all(".pointdequipe-balls i"), {
        gravity: 2200,
        kick: 300,
        restitution: 0.6,
        stagger: 0.14,
        pause: 0.02,
        squash: true,
      })
    }

    if (phase === "done") {
      stagger(all(".pointdequipe-eyebrow, .pointdequipe-title"), 60)
      const box = one(".pointdequipe-summary-edit")
      if (box) pop(box, 140, 0.94)
      return
    }

    if (phase === "sent") {
      const eyebrow = one(".pointdequipe-eyebrow")
      if (eyebrow) enter(eyebrow, 0)
      const title = one(".pointdequipe-title")
      if (title) dropIn(title, 80)
      const text = one(".pointdequipe-summary")
      if (text) enter(text, 380)
      const button = one(".onboarding-button")
      if (button) pop(button, 560, 0.6)
      return
    }

    if (phase === "error") stagger(all(".pointdequipe-idle > *"), 60)
    return undefined
  }, [phase])

  // Le compte rendu écrit, les listes tombent en cascade (les lignes, elles, entrent d'elles-mêmes) et le bouton éclot.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || phase !== "done" || !summaryWritten) return
    stagger(
      root.querySelectorAll<HTMLElement>(
        ".pointdequipe-hint, .pointdequipe-section-title, .pointdequipe-section-empty",
      ),
      60,
    )
    const send = root.querySelector<HTMLElement>(".motion-send")
    const lines = root.querySelectorAll(".pointdequipe-item").length
    if (send) pop(send, 200 + lines * 60, 0.7)
    const back = root.querySelector<HTMLElement>(".pointdequipe-back")
    if (back) enter(back, 320 + lines * 60)
  }, [phase, summaryWritten])

  // Le compte rendu du jour est gardé au fil de l'eau (voir `lib/meetingReports.ts`) : la frise l'affiche
  // dans la carte du point d'équipe, même si l'écran est quitté en cours de route.
  const savedReportRef = useRef("")
  useEffect(() => {
    if (phase !== "recording" && phase !== "done" && phase !== "sent") return
    const kept: StoredMeetingItem[] = items
      .filter((it) => !it.leaving && it.text.trim())
      .map((it) => ({
        type: it.type,
        text: it.text,
        jiraKey: it.jiraStatus === "saved" ? it.jiraKey : undefined,
        jiraUrl: it.jiraStatus === "saved" ? it.jiraUrl : undefined,
      }))
    const status = phase === "recording" ? "recording" : phase
    const snapshot = JSON.stringify([status, summary, kept])
    if (snapshot === savedReportRef.current || (kept.length === 0 && !summary)) return
    savedReportRef.current = snapshot
    saveTodayReport({ status, updatedAt: new Date().toISOString(), summary, items: kept, attendees: peopleRef.current })
  }, [phase, items, summary])

  // Le compteur de tickets éclot quand le premier ticket prend son envol.
  useLayoutEffect(() => {
    const tray = trayRef.current
    if (!trayShown || !tray) return
    pop(tray, 0, 0.2)
  }, [trayShown])

  // Chaque ticket Jira réellement créé pendant l'enregistrement s'envole en arc jusqu'au compteur de la carte.
  useEffect(() => {
    if (phase !== "recording") return
    for (const item of items) {
      if (item.type !== "task" || item.jiraStatus !== "saved" || item.leaving || !item.jiraKey) continue
      if (flownIdsRef.current.has(item.id)) continue
      flownIdsRef.current.add(item.id)
      const chip = rootRef.current?.querySelector(`[data-item-id="${item.id}"] .pointdequipe-item-jira`)
      const tray = trayRef.current
      if (!chip || !tray) continue
      setTrayShown(true)
      const flying = document.createElement("div")
      flying.className = "motion-fly-ticket"
      flying.textContent = item.jiraKey
      const id = item.id
      void flyTo(chip.getBoundingClientRect(), tray, flying).then(() => {
        if (!mountedRef.current || !itemsRef.current.some((it) => it.id === id && !it.leaving)) return
        landedIdsRef.current.add(id)
        setTrayCount(landedIdsRef.current.size)
        // L'atterrissage enfonce le compteur, qui rebondit.
        if (trayRef.current) impulse(trayRef.current, 7)
      })
    }
  }, [items, phase])

  function cleanup(): void {
    if (timerRef.current !== null) clearInterval(timerRef.current)
    typeIntervalsRef.current.forEach(clearInterval)
    typeIntervalsRef.current = []
    void liveRecordingRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    audioCtxRef.current?.close()
    timerRef.current = null
    liveRecordingRef.current = null
    streamRef.current = null
    audioCtxRef.current = null
    analyserRef.current = null
    levelsRef.current = null
  }

  /** L'onde et le point « en direct » lisent l'amplitude réelle du micro (voir `readLevels`). */
  function startWaveform(stream: MediaStream): void {
    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)
    audioCtxRef.current = audioCtx
    analyserRef.current = analyser
    levelsRef.current = new Uint8Array(analyser.frequencyBinCount)
  }

  /** Ajoute un item détecté : il entre, puis son texte s'écrit lettre à lettre ; une tâche crée ensuite son ticket Jira. */
  function addItemAnimated(draft: MeetingItemDraft): void {
    // Au-delà, main refuserait le compte rendu entier : on n'ajoute rien (ni item, ni ticket Jira) et on le signale.
    if (liveItemIdsRef.current.size >= MEETING_REPORT_MAX_ITEMS) {
      setItemLimitReached(true)
      return
    }
    // Cue du prototype : `ping` pour une décision, `tick` pour une tâche, au moment où l'item apparaît.
    playSfx(draft.type === "decision" ? "ping" : "tick")
    const id = `item-${nextItemIdRef.current++}`
    liveItemIdsRef.current.add(id)
    const item: MeetingItem = {
      id,
      type: draft.type,
      text: draft.text,
      typedChars: 0,
      jiraStatus: draft.type === "task" ? "saving" : undefined,
    }
    setItems((prev) => [...prev, item])

    const typeInterval = setInterval(() => {
      const current = itemsRef.current.find((it) => it.id === id)
      if (!current || current.leaving || current.typedChars >= current.text.length) {
        clearInterval(typeInterval)
        typeIntervalsRef.current = typeIntervalsRef.current.filter((iv) => iv !== typeInterval)
        if (current && !current.leaving && draft.type === "task") void createTicketForItem(id, draft.text)
        return
      }
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, typedChars: it.typedChars + 1 } : it)))
    }, TYPE_INTERVAL_MS)
    typeIntervalsRef.current.push(typeInterval)
  }

  async function createTicketForItem(id: string, summaryText: string): Promise<void> {
    try {
      const ticket = await window.api.jira.createIssue(summaryText)
      // La réunion est revenue sur cette tâche pendant que son ticket se créait : on le supprime aussitôt connu.
      if (pendingRemovalIdsRef.current.delete(id)) {
        void window.api.jira.deleteIssue(ticket.key).catch(() => undefined)
        return
      }
      setItems((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, jiraStatus: "saved", jiraKey: ticket.key, jiraUrl: ticket.url } : it,
        ),
      )
      // Le texte a changé pendant la création (regroupement, correction) : le ticket reçoit la version finale.
      const latest = itemsRef.current.find((it) => it.id === id)
      if (latest && !latest.leaving && latest.text !== summaryText) {
        void window.api.jira.updateIssueSummary(ticket.key, latest.text).catch(() => undefined)
      }
      // `saved` du prototype : au moment où le ticket existe réellement, pas au clic.
      playSfx("saved")
    } catch (err) {
      pendingRemovalIdsRef.current.delete(id)
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, jiraStatus: "error", jiraError: cleanIpcErrorMessage(err) } : it)),
      )
    }
  }

  /**
   * La réunion revient sur une décision/tâche déjà notée : on retire l'item (il joue sa sortie,
   * puis quitte l'état), et son vrai ticket Jira s'il en avait un. `cancelled` : abandonné pour de bon, il
   * ne sera plus reproposé. `replaced` : absorbé par un regroupement ou une correction, le sujet reste vivant.
   */
  function removeItem(itemId: string, reason: MeetingRemovalReason = "cancelled"): void {
    const item = itemsRef.current.find((it) => it.id === itemId)
    liveItemIdsRef.current.delete(itemId)
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, leaving: true } : it)))
    removalTimersRef.current.push(
      setTimeout(
        () => setItems((prev) => prev.filter((it) => it.id !== itemId)),
        prefersReducedMotion() ? 0 : LEAVE_MS,
      ),
    )
    if (landedIdsRef.current.delete(itemId)) {
      setTrayCount(landedIdsRef.current.size)
      if (trayRef.current) impulse(trayRef.current, -5)
    }
    if (!item) return
    if (reason === "cancelled") rejectedTextsRef.current.push(item.text)
    if (item.jiraKey) {
      void window.api.jira.deleteIssue(item.jiraKey).catch(() => undefined)
    } else if (item.type === "task") {
      pendingRemovalIdsRef.current.add(itemId)
    }
  }

  /**
   * Les segments sont traités à la file, dans l'ordre : un modèle plus lent qu'un segment ne doit
   * jamais faire perdre le suivant (avant, un segment arrivé pendant un traitement était jeté).
   */
  function handleSegment(audio: Float32Array): Promise<void> {
    if (isSilent(audio)) return segmentChainRef.current
    segmentChainRef.current = segmentChainRef.current.then(() => processSegment(audio))
    return segmentChainRef.current
  }

  async function processSegment(audio: Float32Array): Promise<void> {
    if (!mountedRef.current) return
    try {
      const text = await window.api.speech.transcribe(audio)
      if (!text) return
      fullTranscriptRef.current = appendSegment(fullTranscriptRef.current, text)
      const present = itemsRef.current.filter((it) => !it.leaving)
      const decisionItems = present.filter((it) => it.type === "decision")
      const taskItems = present.filter((it) => it.type === "task")
      const { additions, removals, updates } = await window.api.meeting.extractItems(
        fullTranscriptRef.current,
        decisionItems.map((it) => it.text),
        taskItems.map((it) => it.text),
        rejectedTextsRef.current,
        peopleRef.current.map(firstName),
      )
      const pick = (type: MeetingItemType, index: number): MeetingItem | undefined =>
        (type === "decision" ? decisionItems : taskItems)[index]
      // Les éléments retirés d'abord (sans réécrire ceux qui partent), puis les réécritures, puis les ajouts.
      for (const removal of removals) {
        const target = pick(removal.type, removal.index)
        if (target) removeItem(target.id, removal.reason)
      }
      for (const update of updates) {
        const target = pick(update.type, update.index)
        if (target && !target.leaving) void updateItemText(target.id, update.text)
      }
      additions.forEach(addItemAnimated)
    } catch (err) {
      // Un segment raté (transcription ou extraction) n'interrompt pas l'enregistrement : le suivant prend le relais.
      // Sauf si l'IA est coupée dans les Réglages : on le dit, sinon la liste reste vide sans explication.
      const message = cleanIpcErrorMessage(err)
      if (message.includes("désactivée dans les Réglages")) setError(message)
    }
  }

  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return
    autoStartedRef.current = true
    void handleStart()
    // Une seule fois, à l'arrivée sur l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleStart(): Promise<void> {
    setError(null)
    const granted = await window.api.meeting.requestMicAccess()
    if (!granted) {
      setError("Accès au micro refusé. Autorisez-le dans les réglages système pour utiliser cette fonction.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      startWaveform(stream)
      fullTranscriptRef.current = ""
      segmentChainRef.current = Promise.resolve()
      rejectedTextsRef.current = []
      pendingRemovalIdsRef.current.clear()
      nextItemIdRef.current = 0
      liveItemIdsRef.current.clear()
      flownIdsRef.current.clear()
      landedIdsRef.current.clear()
      stoppingRef.current = false
      reportIdRef.current = crypto.randomUUID()
      setItemLimitReached(false)
      setItems([])
      setElapsed(0)
      setTrayShown(false)
      setTrayCount(0)
      liveRecordingRef.current = await startLiveVoiceRecording(SEGMENT_MS, OVERLAP_MS, (audio) => void handleSegment(audio))
      timerRef.current = setInterval(() => setElapsed((value) => value + 1), 1000)
      // Point de départ de la morphose (bouton → carte), et l'écran de départ s'envole.
      const button = recordButtonRef.current
      const dot = button?.querySelector(".pointdequipe-record-dot")
      morphFromRef.current =
        button && dot ? { button: button.getBoundingClientRect(), dot: dot.getBoundingClientRect() } : null
      if (idleRef.current)
        flingAwayCopy(idleRef.current, (child) => child.classList.contains("pointdequipe-record-button"))
      setPhase("recording")
      playSfx("rec")
    } catch {
      setError("Impossible d'accéder au micro sur cet appareil.")
    }
  }

  /** Arrêt : les lignes tombent une à une (gravité), la carte s'écrase en hauteur avant la largeur. */
  function playRecordingExit(): Promise<void> {
    const root = rootRef.current
    if (!root || prefersReducedMotion()) return Promise.resolve()
    const falling = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".pointdequipe-section-title, .pointdequipe-item, .pointdequipe-section-empty, .dayview-status-pill, .onboarding-error",
      ),
    )
    falling.forEach((el, i) => setTimeout(() => drop(el), i * 45))
    const card = root.querySelector<HTMLElement>(".pointdequipe-card")
    if (card) {
      let sx = 1
      let sy = 1
      const paint = (): void => {
        card.style.scale = `${Math.max(0, sx).toFixed(3)} ${Math.max(0, sy).toFixed(3)}`
      }
      setTimeout(() => {
        spring(1, 0, { stiffness: 170, damping: 15 }, (v) => {
          sx = v
          paint()
        })
        spring(1, 0, { stiffness: 430, damping: 24 }, (v) => {
          sy = v
          paint()
          card.style.opacity = String(Math.max(0, Math.min(1, v * 1.6)))
        })
      }, 120)
    }
    return wait(Math.min(900, 480 + falling.length * 45))
  }

  async function handleStop(): Promise<void> {
    if (stoppingRef.current) return
    stoppingRef.current = true
    // Le segment en cours (même court) est remis avant de couper le micro pour de bon : on l'attend ci-dessous.
    const flush = liveRecordingRef.current?.stop()
    cleanup()
    playSfx("stop")
    const exit = playRecordingExit()
    await exit
    if (!mountedRef.current) return
    setPhase("summarizing")
    // Dernier segment, puis tous ceux encore en cours de transcription : le compte rendu ne doit rien oublier.
    await flush
    await segmentChainRef.current
    if (!mountedRef.current) return
    const fullTranscript = fullTranscriptRef.current.trim()
    if (!fullTranscript) {
      onBack()
      return
    }
    const outcome = window.api.meeting.summarize(fullTranscript, peopleRef.current.map(firstName)).then(
      (result) => ({ ok: true as const, result }),
      (err: unknown) => ({ ok: false as const, err }),
    )
    const settled = await outcome
    if (!mountedRef.current) return
    if (settled.ok) {
      setSummary(settled.result)
      setSummaryWritten(false)
      setSendState("idle")
      setPhase("done")
    } else {
      setError(cleanIpcErrorMessage(settled.err))
      setPhase("error")
    }
  }

  async function handleSendReport(): Promise<void> {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setSendState("sending")
    try {
      // État courant, après corrections et annulations : c'est ce lot que main persiste pour les suggestions.
      await window.api.meeting.sendReport(
        reportIdRef.current,
        itemsRef.current.filter((it) => !it.leaving).map(({ type, text }) => ({ type, text })),
      )
      setError(null)
      setSendState("success")
      playSfx("confirm")
      // Le rapport part : coche tracée, puis chaque bloc est lancé vers le haut avant l'écran « envoyé ».
      if (!prefersReducedMotion()) {
        await wait(520)
        const blocks = rootRef.current?.querySelectorAll<HTMLElement>(".pointdequipe-idle > *") ?? []
        blocks.forEach((block, i) => fling(block, i * 45))
        await wait(520)
      }
      if (mountedRef.current) setPhase("sent")
    } catch (err) {
      // On reste sur le compte rendu : les items n'existent qu'en mémoire, quitter l'écran les perdrait.
      setError(cleanIpcErrorMessage(err))
      setSendState("idle")
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  /** Correction post-enregistrement (transcription parfois fautive) : répercutée sur le vrai ticket Jira si la tâche en a déjà un. */
  async function handleEditItem(id: string, newText: string): Promise<void> {
    setEditingId(null)
    await updateItemText(id, newText)
  }

  /**
   * Réécrit le texte d'un item — correction manuelle, ou la réunion qui précise / regroupe / corrige — et le
   * répercute sur son ticket Jira. Si le ticket est encore en cours de création, `createTicketForItem` rattrape
   * le texte final dès qu'il existe.
   */
  async function updateItemText(id: string, newText: string): Promise<void> {
    const trimmed = newText.trim()
    const item = itemsRef.current.find((it) => it.id === id)
    if (!item || item.leaving || !trimmed || trimmed === item.text) return
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, text: trimmed, typedChars: trimmed.length } : it)))
    // Le texte vient de changer sous les yeux : une pichenette pour le signaler.
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-item-id="${id}"]`)
    if (row) impulse(row, 5)
    if (item.type === "task" && item.jiraKey) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, jiraStatus: "saving" } : it)))
      try {
        await window.api.jira.updateIssueSummary(item.jiraKey, trimmed)
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, jiraStatus: "saved" } : it)))
      } catch (err) {
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, jiraStatus: "error", jiraError: cleanIpcErrorMessage(err) } : it)),
        )
      }
    }
  }

  function renderItem(item: MeetingItem, editable: boolean, enterDelay = 0): React.JSX.Element {
    return (
      <ItemRow
        key={item.id}
        item={item}
        editable={editable}
        editing={editingId === item.id}
        enterDelay={enterDelay}
        people={people}
        onStartEdit={() => setEditingId(item.id)}
        onCommitEdit={(text) => void handleEditItem(item.id, text)}
        onCancelEdit={() => setEditingId(null)}
      />
    )
  }

  // Pendant l'enregistrement, un item retiré reste affiché le temps de sa sortie ; ensuite il n'existe plus.
  const shown = phase === "recording" ? items : items.filter((item) => !item.leaving)
  const decisions = shown.filter((item) => item.type === "decision")
  const tasks = shown.filter((item) => item.type === "task")
  const itemLimitNotice = itemLimitReached ? (
    <p className="onboarding-error">Limite de {MEETING_REPORT_MAX_ITEMS} décisions et tâches atteinte</p>
  ) : null

  let content: React.JSX.Element
  if (phase === "idle") {
    content = (
      <div className="pointdequipe-idle" ref={idleRef}>
        <p className="pointdequipe-eyebrow">Point d&apos;équipe</p>
        <h1 className="pointdequipe-title">Le point d&apos;équipe commence.</h1>
        <p className="pointdequipe-subtitle">J&apos;écoute et j&apos;écris le compte rendu pour vous.</p>

        <button
          ref={recordButtonRef}
          type="button"
          className="pointdequipe-record-button"
          aria-label="Démarrer"
          onClick={() => void handleStart()}
        >
          <span className="pointdequipe-record-dot" aria-hidden="true" />
        </button>
        <p className="pointdequipe-start-label">Démarrer</p>
        <p className="pointdequipe-hint">Audio traité sur cet appareil, jamais enregistré sur disque.</p>

        {meeting && (meeting.meetingUrl || people.length > 0) && (
          <div className="pointdequipe-meeting">
            {meeting.meetingUrl && (
              <a className="pointdequipe-join" href={meeting.meetingUrl} target="_blank" rel="noreferrer">
                🎥 Rejoindre la visio
              </a>
            )}
            <PeopleChips people={people} />
          </div>
        )}

        {error && <p className="onboarding-error">{error}</p>}

        <button type="button" className="onboarding-link onboarding-link--muted pointdequipe-back" onClick={onBack}>
          ‹ Retour
        </button>
      </div>
    )
  } else if (phase === "recording") {
    const sections: [string, MeetingItem[]][] = [
      ["Décisions", decisions],
      ["Tâches", tasks],
    ]
    content = (
      <div className="pointdequipe-recording">
        <div className="pointdequipe-card">
          <span className="pointdequipe-live-dot" aria-hidden="true" />
          <Odometer value={formatDuration(elapsed)} className="pointdequipe-timer" />
          <WaveBars count={WAVE_BARS} readLevels={readLevels} />
          <span
            ref={trayRef}
            className={"pointdequipe-ticket-tray" + (trayShown ? "" : " pointdequipe-ticket-tray--hidden")}
            aria-hidden={!trayShown}
          >
            <TicketIcon />
            <Odometer value={String(trayCount)} />
            <span>{trayCount > 1 ? "tickets" : "ticket"}</span>
          </span>
          <button type="button" className="pointdequipe-stop-button" onClick={() => void handleStop()}>
            <span className="pointdequipe-stop-icon" aria-hidden="true" />
            Arrêter
          </button>
        </div>

        <div className="pointdequipe-live-sections">
          {sections.map(([title, list]) => (
            <section className="pointdequipe-section" key={title} data-flip-key={`section-${title}`}>
              <h2 className="pointdequipe-section-title">{title}</h2>
              {list.length === 0 ? (
                <p className="pointdequipe-section-empty">Rien pour l&apos;instant.</p>
              ) : (
                <ul className="pointdequipe-item-list">{list.map((item) => renderItem(item, false))}</ul>
              )}
            </section>
          ))}
        </div>

        {itemLimitNotice}

        <div className="dayview-status-pill" data-flip-key="status">
          <span className="pointdequipe-live-dot" aria-hidden="true" />
          J&apos;écoute le point
        </div>

        {meeting?.meetingUrl && (
          <a className="pointdequipe-join pointdequipe-join--quiet" href={meeting.meetingUrl} target="_blank" rel="noreferrer">
            🎥 Visio
          </a>
        )}
      </div>
    )
  } else if (phase === "summarizing") {
    content = (
      <div className="pointdequipe-idle">
        <p className="pointdequipe-eyebrow">Rapport en direct</p>
        <h1 className="pointdequipe-title">J&apos;analyse…</h1>
        <div className="pointdequipe-balls" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    )
  } else if (phase === "error") {
    content = (
      <div className="pointdequipe-idle">
        <h1 className="pointdequipe-title">Le compte rendu a échoué.</h1>
        {error && <p className="onboarding-error">{error}</p>}
        <button type="button" className="onboarding-button onboarding-button--primary" onClick={onBack}>
          Retour
        </button>
      </div>
    )
  } else if (phase === "sent") {
    content = (
      <div className="pointdequipe-idle">
        <p className="pointdequipe-eyebrow">Compte rendu</p>
        <h1 className="pointdequipe-title">C&apos;est envoyé.</h1>
        <p className="pointdequipe-summary">
          <PersonText text={summary} people={people} />
        </p>
        <button type="button" className="onboarding-button onboarding-button--primary" onClick={onBack}>
          Retour
        </button>
      </div>
    )
  } else {
    let order = 0
    content = (
      <div className="pointdequipe-idle">
        <p className="pointdequipe-eyebrow">Rapport prêt</p>
        <h1 className="pointdequipe-title">Voici ce que j&apos;ai retenu.</h1>
        {summaryWritten && (
          <p className="pointdequipe-hint">Une erreur de transcription ? Cliquez sur ✎ pour corriger.</p>
        )}
        {summaryWritten ? (
          <textarea
            className="pointdequipe-summary-edit"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        ) : (
          <WrittenText
            text={summary}
            className="pointdequipe-summary-edit"
            people={people}
            onDone={() => setSummaryWritten(true)}
          />
        )}

        {summaryWritten && (
          <>
            <div className="pointdequipe-live-sections">
              <section className="pointdequipe-section">
                <h2 className="pointdequipe-section-title">Décisions</h2>
                {decisions.length === 0 ? (
                  <p className="pointdequipe-section-empty">Aucune décision identifiée.</p>
                ) : (
                  <ul className="pointdequipe-item-list">
                    {decisions.map((item) => renderItem(item, true, 60 * order++))}
                  </ul>
                )}
              </section>
              <section className="pointdequipe-section">
                <h2 className="pointdequipe-section-title">Tâches</h2>
                {tasks.length === 0 ? (
                  <p className="pointdequipe-section-empty">Aucune tâche identifiée.</p>
                ) : (
                  <ul className="pointdequipe-item-list">
                    {tasks.map((item) => renderItem(item, true, 60 * order++))}
                  </ul>
                )}
              </section>
            </div>

            {itemLimitNotice}
            {error && <p className="onboarding-error">{error}</p>}

            <SendButton
              state={sendState}
              label={error ? "Réessayer" : "Envoyer à l'équipe"}
              onClick={() => void handleSendReport()}
            />
            <button
              type="button"
              className="onboarding-link onboarding-link--muted pointdequipe-back"
              disabled={sending}
              onClick={onBack}
            >
              ‹ Retour
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="dayview-screen" ref={rootRef}>
      {content}
    </div>
  )
}

export default PointDEquipeView
