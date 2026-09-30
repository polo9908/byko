import { useEffect, useRef, useState } from "react"
import { isSilent, startVoiceRecording } from "@renderer/lib/voiceRecorder"
import type { VoiceRecording } from "@renderer/lib/voiceRecorder"
import { playSfx } from "@renderer/lib/sound"
import type { AssistantAnswer } from "@shared/assistant"
import "../onboarding/onboarding.css"
import "../journal/journal.css"
import "./dayview.css"

type Phase = "idle" | "listening" | "transcribing" | "typing" | "thinking" | "answered" | "error"

/** `ipcRenderer.invoke` préfixe tout rejet avec "Error invoking remote method '<canal>': " : on l'enlève pour l'UI. */
function cleanIpcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

/** Règles fixes sur l'heure et le jour, sans appel IA : 2 à 4 questions plausibles à cet instant. */
function suggestionsFor(now: Date): string[] {
  const hour = now.getHours()
  const day = now.getDay()
  const suggestions: string[] = []
  suggestions.push(hour < 12 ? "Mes tickets ouverts" : "Mes tickets mis à jour aujourd'hui")
  if (day === 5) suggestions.push("Récap de la semaine")
  if (day === 1 && hour < 12) suggestions.push("Ce qui a bougé depuis vendredi")
  suggestions.push("Mes tickets bloqués", "Mes tickets en revue")
  return suggestions.slice(0, 4)
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
}

/**
 * Bouton « Parler à BCC » (ticket B4). Espace (ou clic) lance l'enregistrement,
 * Espace à nouveau l'arrête ; l'audio est transcrit localement par Whisper dans
 * le process main, puis envoyé au fournisseur IA connecté. Le mode texte est
 * accessible directement (bouton ou touche T), et sert aussi de repli si le
 * micro ou la transcription échoue.
 */
function TalkToBcc(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle")
  const [typedText, setTypedText] = useState("")
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const recordingRef = useRef<VoiceRecording | null>(null)
  const ticketRowsRef = useRef<(HTMLAnchorElement | null)[]>([])

  useEffect(() => {
    // Préchargement du modèle (téléchargé une seule fois) pour que la première transcription soit rapide.
    window.api.speech.prepare().catch(() => undefined)
    return () => recordingRef.current?.cancel()
  }, [])

  function fallBackToTyping(hint: string): void {
    setVoiceHint(hint)
    setPhase("typing")
  }

  function handleOpenTyping(): void {
    setAnswer(null)
    setError(null)
    setVoiceHint(null)
    setPhase("typing")
  }

  async function ask(question: string): Promise<void> {
    setLastQuestion(question)
    setFocusedIndex(-1)
    setPhase("thinking")
    setError(null)
    try {
      const result = await window.api.assistant.ask(question)
      setAnswer(result)
      setPhase("answered")
      // Le prototype sonne `confirm` au moment où BCC a fait ce qui lui était demandé.
      playSfx("confirm")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
      setPhase("error")
    }
  }

  async function handleOpen(): Promise<void> {
    setAnswer(null)
    setError(null)
    setVoiceHint(null)
    setPhase("listening")
    const granted = await window.api.meeting.requestMicAccess()
    if (!granted) {
      fallBackToTyping(
        "Accès au micro refusé — autorisez-le dans Réglages Système › Confidentialité et sécurité › Microphone, ou écrivez votre question.",
      )
      return
    }
    try {
      recordingRef.current = await startVoiceRecording()
      // `listen` du prototype : au moment où l'écoute commence réellement (jamais si le micro est refusé).
      playSfx("listen")
    } catch {
      fallBackToTyping("Micro indisponible sur cet appareil — écrivez votre question.")
    }
  }

  async function handleStopListening(): Promise<void> {
    const recording = recordingRef.current
    if (!recording) return
    recordingRef.current = null
    setPhase("transcribing")
    try {
      const audio = await recording.stop()
      const text = isSilent(audio) ? "" : await window.api.speech.transcribe(audio)
      if (!text) {
        fallBackToTyping("Je n'ai rien entendu — réessayez avec Espace ou écrivez votre question.")
        return
      }
      await ask(text)
    } catch (err) {
      fallBackToTyping(`Transcription impossible (${cleanIpcErrorMessage(err)}) — écrivez votre question.`)
    }
  }

  function handleAnsweredKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault()
      handleClose()
      return
    }
    const count = answer?.tickets.length ?? 0
    if (count === 0) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setFocusedIndex((current) => (current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count))
      return
    }
    // Si la ligne a déjà le focus DOM, Entrée l'active nativement : on ne clique que si le focus est ailleurs
    // (corps de page), sinon le ticket s'ouvrirait deux fois — et on laisse Entrée à « Fermer » s'il a le focus.
    if (event.key === "Enter" && focusedIndex >= 0 && (event.target === document.body || event.target === null)) {
      event.preventDefault()
      ticketRowsRef.current[focusedIndex]?.click()
    }
  }

  useEffect(() => {
    if (focusedIndex >= 0) ticketRowsRef.current[focusedIndex]?.focus()
  }, [focusedIndex])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (phase === "answered" || phase === "error") {
        if (!isEditableTarget(event.target)) handleAnsweredKey(event)
        return
      }
      if (event.repeat || isEditableTarget(event.target)) return
      if (event.code === "Space" && (phase === "idle" || phase === "listening")) {
        event.preventDefault()
        if (phase === "idle") void handleOpen()
        else void handleStopListening()
        return
      }
      // T (« taper ») plutôt qu'Entrée : Entrée activerait aussi le bouton qui a le focus, et une lettre
      // ne peut pas se confondre avec Espace. Sans modificateur pour laisser passer Cmd/Ctrl+T.
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey
      if (phase === "idle" && !hasModifier && event.key.toLowerCase() === "t") {
        // preventDefault évite que le « t » soit inséré dans le champ qui prend le focus juste après.
        event.preventDefault()
        handleOpenTyping()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function handleClose(): void {
    recordingRef.current?.cancel()
    recordingRef.current = null
    setPhase("idle")
    setTypedText("")
    setFocusedIndex(-1)
  }

  function handleSubmitTyped(): void {
    if (!typedText.trim()) return
    void ask(typedText.trim())
  }

  if (phase === "idle") {
    return (
      <div className="dayview-talk-idle">
        <div className="dayview-talk-idle-actions">
          <button
            type="button"
            className="dayview-status-pill dayview-talk-button"
            onClick={() => void handleOpen()}
          >
            <span className="dayview-status-dot" aria-hidden="true" />
            Parler à BCC
          </button>
          <button
            type="button"
            className="dayview-talk-type-button"
            onClick={handleOpenTyping}
            aria-label="Écrire à BCC"
            title="Écrire à BCC (T)"
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
              <rect x="0.75" y="0.75" width="16.5" height="12.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 4.5h1M8.5 4.5h1M13 4.5h1M4 7h1M8.5 7h1M13 7h1M5.5 10h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="dayview-talk-kbd-hint">
          <kbd className="dayview-kbd">Espace</kbd> pour parler, <kbd className="dayview-kbd">T</kbd> pour écrire
        </p>
      </div>
    )
  }

  return (
    <div className="dayview-talk-panel">
      {phase === "listening" && (
        <>
          <p className="dayview-talk-status">
            <span className="dayview-talk-live-dot" aria-hidden="true" />
            Je vous écoute…
          </p>
          <button
            type="button"
            className="onboarding-button onboarding-button--primary"
            onClick={() => void handleStopListening()}
          >
            Envoyer
          </button>
          <p className="dayview-talk-kbd-hint">
            ou appuyez à nouveau sur <kbd className="dayview-kbd">Espace</kbd>
          </p>
        </>
      )}

      {phase === "transcribing" && <p className="dayview-talk-status">Transcription…</p>}

      {phase === "typing" && (
        <div className="dayview-talk-input-group">
          {voiceHint && <p className="dayview-talk-voice-hint">{voiceHint}</p>}
          <div className="dayview-talk-input-row">
            <input
              className="onboarding-input dayview-talk-input"
              type="text"
              placeholder="Écrivez votre question à BCC…"
              value={typedText}
              autoFocus
              onChange={(event) => setTypedText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSubmitTyped()
                else if (event.key === "Escape") handleClose()
                else if (event.key === "ArrowUp" && typedText === "" && lastQuestion) {
                  event.preventDefault()
                  setTypedText(lastQuestion)
                }
              }}
            />
            <button type="button" className="onboarding-button onboarding-button--primary" onClick={handleSubmitTyped}>
              Envoyer
            </button>
          </div>
          <div className="dayview-talk-suggestions">
            {suggestionsFor(new Date()).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="dayview-suggestion-chip"
                onClick={() => void ask(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
          {lastQuestion && (
            <p className="dayview-talk-kbd-hint dayview-talk-recall-hint">
              <kbd className="dayview-kbd">↑</kbd> pour reprendre la dernière question
            </p>
          )}
        </div>
      )}

      {phase === "thinking" && <p className="dayview-talk-status">BCC réfléchit…</p>}

      {phase === "answered" && answer && (
        <div className="dayview-talk-answer-block">
          <p className="dayview-talk-answer">{answer.text}</p>
          {answer.tickets.length > 0 && (
            <div className="dayview-talk-tickets">
              {answer.tickets.map((ticket, index) => (
                <a
                  key={ticket.id}
                  ref={(element) => {
                    ticketRowsRef.current[index] = element
                  }}
                  className={
                    index === focusedIndex ? "journal-ticket-row journal-ticket-row--focused" : "journal-ticket-row"
                  }
                  href={ticket.url}
                  target="_blank"
                  rel="noreferrer"
                  onFocus={() => setFocusedIndex(index)}
                >
                  <span className="journal-ticket-key">{ticket.key}</span>
                  <span className="journal-ticket-summary">{ticket.summary}</span>
                  <span className="journal-ticket-status">{ticket.status}</span>
                  <span className="journal-ticket-chevron" aria-hidden="true">
                    ›
                  </span>
                </a>
              ))}
            </div>
          )}
          {answer.tickets.length > 0 && (
            <p className="dayview-talk-kbd-hint dayview-talk-recall-hint">
              <kbd className="dayview-kbd">↑</kbd> <kbd className="dayview-kbd">↓</kbd> pour parcourir,{" "}
              <kbd className="dayview-kbd">Entrée</kbd> pour ouvrir, <kbd className="dayview-kbd">Échap</kbd> pour
              fermer
            </p>
          )}
        </div>
      )}

      {phase === "error" && error && <p className="onboarding-error">{error}</p>}

      <button type="button" className="onboarding-link onboarding-link--muted dayview-talk-close" onClick={handleClose}>
        Fermer
      </button>
    </div>
  )
}

export default TalkToBcc
