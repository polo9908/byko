import { useEffect, useRef, useState } from "react"
import { isSilent, startLiveVoiceRecording } from "@renderer/lib/voiceRecorder"
import type { LiveVoiceRecording } from "@renderer/lib/voiceRecorder"
import { playSfx } from "@renderer/lib/sound"
import { MEETING_ITEM_MAX_CHARS, MEETING_REPORT_MAX_ITEMS } from "@shared/meeting"
import type { MeetingItemDraft, MeetingItemType } from "@shared/meeting"
import "../onboarding/onboarding.css"
import "./pointdequipe.css"

type Phase = "idle" | "recording" | "summarizing" | "done" | "sent" | "error"

/** Segment de transcription "en direct" (voir `startLiveVoiceRecording`) : ni trop réactif, ni trop lent à l'appel IA. */
const SEGMENT_MS = 8000
const TYPE_INTERVAL_MS = 28

interface MeetingItem {
  id: string
  type: MeetingItemType
  text: string
  typedChars: number
  entering: boolean
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

interface PointDEquipeViewProps {
  onBack: () => void
}

/**
 * Mode « Point d'équipe » (ticket B3). Capture micro réelle (getUserMedia),
 * visualisation d'onde à partir de l'amplitude réelle du signal, transcription
 * "en direct" par segments successifs (Whisper local, voir `voiceRecorder.ts`
 * et `main/speech.ts` — pas de vrai streaming, mais un nouveau segment toutes
 * les `SEGMENT_MS`). Chaque segment est envoyé à l'IA pour en extraire les
 * décisions/tâches nouvelles, affichées avec la même animation que le
 * prototype (apparition, texte qui s'écrit, étiquette Jira "enregistrement…"
 * puis "enregistré") — mais sur de vraies données : rien n'est affiché tant
 * que l'IA ne l'a pas identifié dans ce qui a été réellement dit, et les
 * tickets créés sont de vrais tickets Jira (voir `jira.createIssue`).
 *
 * Aucun fichier audio n'est jamais écrit sur disque : le flux micro n'existe
 * qu'en mémoire et est coupé à l'arrêt.
 */
function PointDEquipeView({ onBack }: PointDEquipeViewProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [waveform, setWaveform] = useState<number[]>(() => Array(24).fill(2))
  const [items, setItems] = useState<MeetingItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [summary, setSummary] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [itemLimitReached, setItemLimitReached] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveRecordingRef = useRef<LiveVoiceRecording | null>(null)
  const fullTranscriptRef = useRef("")
  const itemsRef = useRef<MeetingItem[]>([])
  const processingRef = useRef(false)
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

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => () => cleanup(), [])

  function cleanup(): void {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (timerRef.current !== null) clearInterval(timerRef.current)
    typeIntervalsRef.current.forEach(clearInterval)
    typeIntervalsRef.current = []
    liveRecordingRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    audioCtxRef.current?.close()
    rafRef.current = null
    timerRef.current = null
    liveRecordingRef.current = null
    streamRef.current = null
    audioCtxRef.current = null
  }

  function startWaveform(stream: MediaStream): void {
    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)
    audioCtxRef.current = audioCtx
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = (): void => {
      analyser.getByteFrequencyData(data)
      setWaveform(Array.from(data.slice(0, 24)).map((value) => Math.max(2, Math.round((value / 255) * 20))))
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  /** Anime l'apparition d'un item comme le prototype : entrée, texte tapé lettre par lettre, puis création Jira si tâche. */
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
      entering: false,
      jiraStatus: draft.type === "task" ? "saving" : undefined,
    }
    setItems((prev) => [...prev, item])
    setTimeout(() => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, entering: true } : it)))
    }, 40)

    const typeInterval = setInterval(() => {
      const current = itemsRef.current.find((it) => it.id === id)
      if (!current || current.typedChars >= current.text.length) {
        clearInterval(typeInterval)
        typeIntervalsRef.current = typeIntervalsRef.current.filter((iv) => iv !== typeInterval)
        if (current && draft.type === "task") void createTicketForItem(id, draft.text)
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
        prev.map((it) => (it.id === id ? { ...it, jiraStatus: "saved", jiraKey: ticket.key, jiraUrl: ticket.url } : it)),
      )
      // `saved` du prototype : au moment où le ticket existe réellement, pas au clic.
      playSfx("saved")
    } catch (err) {
      pendingRemovalIdsRef.current.delete(id)
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, jiraStatus: "error", jiraError: cleanIpcErrorMessage(err) } : it)),
      )
    }
  }

  /** La réunion revient sur une décision/tâche déjà notée : on retire l'item, et son vrai ticket Jira s'il en avait un. */
  function removeItem(itemId: string): void {
    const item = itemsRef.current.find((it) => it.id === itemId)
    liveItemIdsRef.current.delete(itemId)
    setItems((prev) => prev.filter((it) => it.id !== itemId))
    if (!item) return
    rejectedTextsRef.current.push(item.text)
    if (item.jiraKey) {
      void window.api.jira.deleteIssue(item.jiraKey).catch(() => undefined)
    } else if (item.type === "task") {
      pendingRemovalIdsRef.current.add(itemId)
    }
  }

  async function handleSegment(audio: Float32Array): Promise<void> {
    if (isSilent(audio) || processingRef.current) return
    processingRef.current = true
    try {
      const text = await window.api.speech.transcribe(audio)
      if (!text) return
      fullTranscriptRef.current = `${fullTranscriptRef.current} ${text}`.trim()
      const decisionItems = itemsRef.current.filter((it) => it.type === "decision")
      const taskItems = itemsRef.current.filter((it) => it.type === "task")
      const { additions, removals } = await window.api.meeting.extractItems(
        fullTranscriptRef.current,
        decisionItems.map((it) => it.text),
        taskItems.map((it) => it.text),
        rejectedTextsRef.current,
      )
      for (const removal of removals) {
        const target = (removal.type === "decision" ? decisionItems : taskItems)[removal.index]
        if (target) removeItem(target.id)
      }
      additions.forEach(addItemAnimated)
    } catch {
      // Un segment raté (transcription ou extraction) n'interrompt pas l'enregistrement : le suivant prend le relais.
    } finally {
      processingRef.current = false
    }
  }

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
      rejectedTextsRef.current = []
      pendingRemovalIdsRef.current.clear()
      nextItemIdRef.current = 0
      liveItemIdsRef.current.clear()
      reportIdRef.current = crypto.randomUUID()
      setItemLimitReached(false)
      setItems([])
      setElapsed(0)
      liveRecordingRef.current = await startLiveVoiceRecording(SEGMENT_MS, (audio) => void handleSegment(audio))
      timerRef.current = setInterval(() => setElapsed((value) => value + 1), 1000)
      setPhase("recording")
      playSfx("rec")
    } catch {
      setError("Impossible d'accéder au micro sur cet appareil.")
    }
  }

  async function handleStop(): Promise<void> {
    cleanup()
    playSfx("stop")
    const fullTranscript = fullTranscriptRef.current.trim()
    if (!fullTranscript) {
      onBack()
      return
    }
    setPhase("summarizing")
    try {
      const result = await window.api.meeting.summarize(fullTranscript)
      setSummary(result)
      setPhase("done")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setPhase("error")
    }
  }

  async function handleSendReport(): Promise<void> {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      // État courant, après corrections et annulations : c'est ce lot que main persiste pour les suggestions.
      await window.api.meeting.sendReport(
        reportIdRef.current,
        itemsRef.current.map(({ type, text }) => ({ type, text })),
      )
      setError(null)
      setPhase("sent")
      playSfx("confirm")
    } catch (err) {
      // On reste sur le compte rendu : les items n'existent qu'en mémoire, quitter l'écran les perdrait.
      setError(cleanIpcErrorMessage(err))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  /** Correction post-enregistrement (transcription parfois fautive) : répercutée sur le vrai ticket Jira si la tâche en a déjà un. */
  async function handleEditItem(id: string, newText: string): Promise<void> {
    setEditingId(null)
    const trimmed = newText.trim()
    const item = itemsRef.current.find((it) => it.id === id)
    if (!item || !trimmed || trimmed === item.text) return
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, text: trimmed, typedChars: trimmed.length } : it)))
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

  function renderItem(item: MeetingItem, editable: boolean): React.JSX.Element {
    const displayedText = item.text.slice(0, item.typedChars)
    const isEditing = editingId === item.id
    return (
      <li
        key={item.id}
        className={"pointdequipe-item" + (item.entering ? " pointdequipe-item--in" : "")}
        data-type={item.type}
      >
        <span className="pointdequipe-item-dot" aria-hidden="true" />
        {isEditing ? (
          <input
            className="pointdequipe-item-edit-input"
            defaultValue={item.text}
            maxLength={MEETING_ITEM_MAX_CHARS}
            autoFocus
            onBlur={(event) => void handleEditItem(item.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") setEditingId(null)
            }}
          />
        ) : (
          <span className="pointdequipe-item-text">
            {displayedText}
            {item.typedChars < item.text.length && <span className="pointdequipe-caret" aria-hidden="true" />}
          </span>
        )}
        {editable && !isEditing && item.typedChars >= item.text.length && (
          <button
            type="button"
            className="pointdequipe-item-edit-button"
            aria-label="Corriger"
            onClick={() => setEditingId(item.id)}
          >
            ✎
          </button>
        )}
        {item.type === "task" && item.typedChars >= item.text.length && (
          <span className={"pointdequipe-item-jira pointdequipe-item-jira--" + (item.jiraStatus ?? "saving")}>
            {item.jiraStatus === "saved" && item.jiraUrl ? (
              <a href={item.jiraUrl} target="_blank" rel="noreferrer">
                {item.jiraKey} ✓
              </a>
            ) : item.jiraStatus === "error" ? (
              (item.jiraError ?? "Échec de création du ticket")
            ) : (
              "Création du ticket…"
            )}
          </span>
        )}
      </li>
    )
  }

  const decisions = items.filter((item) => item.type === "decision")
  const tasks = items.filter((item) => item.type === "task")
  const itemLimitNotice = itemLimitReached ? (
    <p className="onboarding-error">Limite de {MEETING_REPORT_MAX_ITEMS} décisions et tâches atteinte</p>
  ) : null

  if (phase === "idle") {
    return (
      <div className="dayview-screen">
        <div className="pointdequipe-idle">
          <p className="pointdequipe-eyebrow">Point d&apos;équipe</p>
          <h1 className="pointdequipe-title">Le point d&apos;équipe commence.</h1>
          <p className="pointdequipe-subtitle">J&apos;écoute et j&apos;écris le compte rendu pour vous.</p>

          <button type="button" className="pointdequipe-record-button" onClick={() => void handleStart()}>
            <span className="pointdequipe-record-dot" aria-hidden="true" />
          </button>
          <p className="pointdequipe-start-label">Démarrer</p>
          <p className="pointdequipe-hint">Audio traité sur cet appareil, jamais enregistré sur disque.</p>

          {error && <p className="onboarding-error">{error}</p>}

          <button type="button" className="onboarding-link onboarding-link--muted pointdequipe-back" onClick={onBack}>
            ‹ Retour
          </button>
        </div>
      </div>
    )
  }

  if (phase === "recording") {
    return (
      <div className="dayview-screen">
        <div className="pointdequipe-recording">
          <div className="pointdequipe-card">
            <span className="pointdequipe-live-dot" aria-hidden="true" />
            <span className="pointdequipe-timer">{formatDuration(elapsed)}</span>
            <div className="pointdequipe-waveform" aria-hidden="true">
              {waveform.map((height, index) => (
                <span key={index} className="pointdequipe-wave-bar" style={{ height: `${height}px` }} />
              ))}
            </div>
            <button type="button" className="pointdequipe-stop-button" onClick={() => void handleStop()}>
              <span className="pointdequipe-stop-icon" aria-hidden="true" />
              Arrêter
            </button>
          </div>

          <div className="pointdequipe-live-sections">
            <section className="pointdequipe-section">
              <h2 className="pointdequipe-section-title">Décisions</h2>
              {decisions.length === 0 ? (
                <p className="pointdequipe-section-empty">Rien pour l&apos;instant.</p>
              ) : (
                <ul className="pointdequipe-item-list">{decisions.map((item) => renderItem(item, false))}</ul>
              )}
            </section>
            <section className="pointdequipe-section">
              <h2 className="pointdequipe-section-title">Tâches</h2>
              {tasks.length === 0 ? (
                <p className="pointdequipe-section-empty">Rien pour l&apos;instant.</p>
              ) : (
                <ul className="pointdequipe-item-list">{tasks.map((item) => renderItem(item, false))}</ul>
              )}
            </section>
          </div>

          {itemLimitNotice}

          <div className="dayview-status-pill">
            <span className="pointdequipe-live-dot" aria-hidden="true" />
            J&apos;écoute le point
          </div>
        </div>
      </div>
    )
  }

  if (phase === "summarizing") {
    return (
      <div className="dayview-screen">
        <div className="pointdequipe-idle">
          <p className="pointdequipe-eyebrow">Rapport en direct</p>
          <h1 className="pointdequipe-title">J&apos;analyse…</h1>
        </div>
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="dayview-screen">
        <div className="pointdequipe-idle">
          <h1 className="pointdequipe-title">Le compte rendu a échoué.</h1>
          {error && <p className="onboarding-error">{error}</p>}
          <button type="button" className="onboarding-button onboarding-button--primary" onClick={onBack}>
            Retour
          </button>
        </div>
      </div>
    )
  }

  if (phase === "sent") {
    return (
      <div className="dayview-screen">
        <div className="pointdequipe-idle">
          <p className="pointdequipe-eyebrow">Compte rendu</p>
          <h1 className="pointdequipe-title">C&apos;est envoyé.</h1>
          <p className="pointdequipe-summary">{summary}</p>
          <button type="button" className="onboarding-button onboarding-button--primary" onClick={onBack}>
            Retour
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dayview-screen">
      <div className="pointdequipe-idle">
        <p className="pointdequipe-eyebrow">Rapport prêt</p>
        <h1 className="pointdequipe-title">Voici ce que j&apos;ai retenu.</h1>
        <p className="pointdequipe-hint">Une erreur de transcription ? Cliquez sur ✎ pour corriger.</p>
        <textarea
          className="pointdequipe-summary-edit"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />

        <div className="pointdequipe-live-sections">
          <section className="pointdequipe-section">
            <h2 className="pointdequipe-section-title">Décisions</h2>
            {decisions.length === 0 ? (
              <p className="pointdequipe-section-empty">Aucune décision identifiée.</p>
            ) : (
              <ul className="pointdequipe-item-list">{decisions.map((item) => renderItem(item, true))}</ul>
            )}
          </section>
          <section className="pointdequipe-section">
            <h2 className="pointdequipe-section-title">Tâches</h2>
            {tasks.length === 0 ? (
              <p className="pointdequipe-section-empty">Aucune tâche identifiée.</p>
            ) : (
              <ul className="pointdequipe-item-list">{tasks.map((item) => renderItem(item, true))}</ul>
            )}
          </section>
        </div>

        {itemLimitNotice}
        {error && <p className="onboarding-error">{error}</p>}

        <button
          type="button"
          className="onboarding-button onboarding-button--primary"
          disabled={sending}
          onClick={() => void handleSendReport()}
        >
          {sending ? "Envoi…" : error ? "Réessayer" : "Envoyer à l'équipe"}
        </button>
        <button
          type="button"
          className="onboarding-link onboarding-link--muted pointdequipe-back"
          disabled={sending}
          onClick={onBack}
        >
          ‹ Retour
        </button>
      </div>
    </div>
  )
}

export default PointDEquipeView
