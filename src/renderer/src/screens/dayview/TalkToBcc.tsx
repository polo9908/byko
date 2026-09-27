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

/**
 * Bouton « Parler à BCC » (ticket B4). Espace (ou clic) lance l'enregistrement,
 * Espace à nouveau l'arrête ; l'audio est transcrit localement par Whisper dans
 * le process main, puis envoyé au fournisseur IA connecté. Repli texte visible
 * si le micro ou la transcription échoue.
 */
function TalkToBcc(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle")
  const [typedText, setTypedText] = useState("")
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const recordingRef = useRef<VoiceRecording | null>(null)

  useEffect(() => {
    // Préchargement du modèle (téléchargé une seule fois) pour que la première transcription soit rapide.
    window.api.speech.prepare().catch(() => undefined)
    return () => recordingRef.current?.cancel()
  }, [])

  function fallBackToTyping(hint: string): void {
    setVoiceHint(hint)
    setPhase("typing")
  }

  async function ask(question: string): Promise<void> {
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.code !== "Space" || event.repeat) return
      if (phase !== "idle" && phase !== "listening") return
      const target = event.target as HTMLElement | null
      const isEditable =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable
      if (isEditable) return
      event.preventDefault()
      if (phase === "idle") void handleOpen()
      else void handleStopListening()
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
  }

  function handleSubmitTyped(): void {
    if (!typedText.trim()) return
    void ask(typedText.trim())
  }

  if (phase === "idle") {
    return (
      <div className="dayview-talk-idle">
        <button
          type="button"
          className="dayview-status-pill dayview-talk-button"
          onClick={() => void handleOpen()}
        >
          <span className="dayview-status-dot" aria-hidden="true" />
          Parler à BCC
        </button>
        <p className="dayview-talk-kbd-hint">
          ou appuyez sur <kbd className="dayview-kbd">Espace</kbd>
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
              }}
            />
            <button type="button" className="onboarding-button onboarding-button--primary" onClick={handleSubmitTyped}>
              Envoyer
            </button>
          </div>
        </div>
      )}

      {phase === "thinking" && <p className="dayview-talk-status">BCC réfléchit…</p>}

      {phase === "answered" && answer && (
        <div className="dayview-talk-answer-block">
          <p className="dayview-talk-answer">{answer.text}</p>
          {answer.tickets.length > 0 && (
            <div className="dayview-talk-tickets">
              {answer.tickets.map((ticket) => (
                <a
                  key={ticket.id}
                  className="journal-ticket-row"
                  href={ticket.url}
                  target="_blank"
                  rel="noreferrer"
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
