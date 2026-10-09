import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { isSilent, startVoiceRecording } from "@renderer/lib/voiceRecorder"
import type { VoiceRecording } from "@renderer/lib/voiceRecorder"
import { playSfx } from "@renderer/lib/sound"
import { enter, heartbeat, pop, stagger } from "@renderer/lib/motion"
import { completeTyped, GHOST_MIN_CHARS } from "@renderer/lib/completion"
import { ASSISTANT_SUGGEST_MIN_CHARS } from "@shared/assistant"
import type { AssistantAnswer, AssistantSuggestion, AssistantSuggestionKind } from "@shared/assistant"
import type { PersonalShortcut } from "@shared/vocabulary"
import { VOCABULARY_MIN_CHARS } from "@shared/vocabulary"
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

const SUGGEST_DEBOUNCE_MS = 200

const SUGGESTION_KIND_LABEL: Record<AssistantSuggestionKind, string> = {
  ticket: "Ticket",
  journal: "Hier",
  decision: "Réunion",
}

/** Questions types (chips), et en tête les raccourcis appris : corpus local de la complétion fantôme. */
function completionCorpus(shortcuts: PersonalShortcut[]): string[] {
  const base = [
    "Mes tickets ouverts",
    "Mes tickets mis à jour aujourd'hui",
    "Mes tickets bloqués",
    "Mes tickets en revue",
    "Récap de la semaine",
    "Ce qui a bougé depuis vendredi",
    "Qu'est-ce qui est bloqué ?",
    "Qu'est-ce qui est en revue ?",
  ]
  return [...shortcuts.flatMap((shortcut) => [shortcut.typed, shortcut.question]), ...base]
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
  const [liveSuggestions, setLiveSuggestions] = useState<AssistantSuggestion[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestIndex, setSuggestIndex] = useState(-1)
  const [shortcuts, setShortcuts] = useState<PersonalShortcut[]>([])
  const [inputFocused, setInputFocused] = useState(false)
  // La complétion fantôme ne s'affiche qu'au bout de la saisie : au milieu, « le reste de la phrase » n'a pas de sens.
  const [caretAtEnd, setCaretAtEnd] = useState(true)
  const recordingRef = useRef<VoiceRecording | null>(null)
  const ticketRowsRef = useRef<(HTMLAnchorElement | null)[]>([])
  const suggestRequestRef = useRef(0)
  const suggestListId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  // Mouvement de chaque état du panneau (voir `lib/motion.ts`) : il arrive en ressort, le point
  // « Je vous écoute » bat comme un cœur, la réponse et ses tickets entrent en cascade.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const all = (selector: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector))
    if (phase === "idle") {
      stagger(all(".dayview-talk-idle-actions > *, .dayview-talk-kbd-hint"), 50)
      return
    }
    if (phase === "listening") {
      stagger(all(".dayview-talk-status, .dayview-talk-echo, .dayview-talk-listen-actions, .dayview-talk-kbd-hint"), 50)
      const stops = all(".dayview-talk-live-dot").map((dot) => heartbeat(dot))
      return () => stops.forEach((stop) => stop())
    }
    if (phase === "answered") {
      const answerText = root.querySelector<HTMLElement>(".dayview-talk-answer")
      if (answerText) enter(answerText, 0)
      stagger(all(".dayview-talk-tickets .journal-ticket-row, .dayview-talk-recall-hint"), 55, 90)
      return
    }
    stagger(all(".dayview-talk-status, .dayview-talk-input-group"), 50)
    return undefined
  }, [phase])

  useEffect(() => {
    // Préchargement du modèle (téléchargé une seule fois) pour que la première transcription soit rapide.
    window.api.speech.prepare().catch(() => undefined)
    return () => recordingRef.current?.cancel()
  }, [])

  useEffect(() => {
    // Raccourcis appris localement : corpus de complétion et marque « appris » dans la liste.
    window.api.vocabulary
      .list()
      .then((result) => setShortcuts(result))
      .catch(() => undefined)
  }, [])

  function refreshShortcuts(): void {
    window.api.vocabulary
      .list()
      .then((result) => setShortcuts(result))
      .catch(() => undefined)
  }

  useEffect(() => {
    // Chaque frappe (ou sortie de la phase) invalide la requête en vol : seule la plus récente peut s'afficher.
    const requestId = ++suggestRequestRef.current
    let disposed = false
    const query = typedText.trim()
    if (phase !== "typing" || query.length < ASSISTANT_SUGGEST_MIN_CHARS) {
      setLiveSuggestions([])
      setSuggestIndex(-1)
      return
    }
    const timer = window.setTimeout(() => {
      window.api.assistant
        .suggest(query)
        .then((result) => {
          if (disposed || requestId !== suggestRequestRef.current) return
          setLiveSuggestions(result)
          setSuggestIndex(-1)
        })
        .catch(() => {
          // Pas de repli inventé : la liste disparaît, le texte tapé reste soumissible tel quel.
          if (disposed || requestId !== suggestRequestRef.current) return
          setLiveSuggestions([])
          setSuggestIndex(-1)
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [phase, typedText])

  const suggestVisible =
    phase === "typing" &&
    suggestOpen &&
    liveSuggestions.length > 0 &&
    typedText.trim().length >= ASSISTANT_SUGGEST_MIN_CHARS

  // La liste de suggestions éclot quand elle apparaît.
  useLayoutEffect(() => {
    const list = rootRef.current?.querySelector<HTMLElement>(".dayview-talk-suggest")
    if (suggestVisible && list) pop(list, 0, 0.96)
  }, [suggestVisible])

  // Complétion fantôme : proposée seulement quand la liste de suggestions ne prend pas déjà l'écran.
  const ghost =
    phase === "typing" &&
    inputFocused &&
    caretAtEnd &&
    !suggestVisible &&
    typedText.trim().length >= GHOST_MIN_CHARS
      ? completeTyped(typedText, completionCorpus(shortcuts))
      : null

  function fallBackToTyping(hint: string): void {
    setVoiceHint(hint)
    setPhase("typing")
  }

  function handleOpenTyping(): void {
    setAnswer(null)
    setError(null)
    setVoiceHint(null)
    setSuggestOpen(false)
    setPhase("typing")
  }

  /**
   * Valide une suggestion : c'est le moment où l'utilisateur confirme « ce qu'il a
   * tapé → cette suggestion ». On l'apprend localement (jamais transmis à l'IA),
   * puis on pose la question associée.
   */
  function chooseSuggestion(suggestion: AssistantSuggestion): void {
    learnShortcut(typedText, suggestion)
    void ask(suggestion.question)
  }

  function learnShortcut(query: string, suggestion: AssistantSuggestion): void {
    const phrase = query.trim()
    if (phrase.length < VOCABULARY_MIN_CHARS) return
    // `personal:<kind>:<targetId>` ou `<kind>:<targetId>` : la cible réelle est la même.
    const target = suggestion.id.startsWith("personal:")
      ? suggestion.id.slice("personal:".length)
      : suggestion.id
    const separator = target.indexOf(":")
    if (separator <= 0) return
    const kind = target.slice(0, separator)
    const targetId = target.slice(separator + 1)
    if (kind !== "ticket" && kind !== "journal" && kind !== "decision") return
    if (targetId === "") return
    window.api.vocabulary
      .record(phrase, {
        kind,
        targetId,
        label: suggestion.label,
        question: suggestion.question,
        ...(suggestion.detail === undefined ? {} : { detail: suggestion.detail }),
      })
      .then(() => refreshShortcuts())
      .catch(() => undefined)
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

  /** Démarre l'écoute sans toucher au texte déjà tapé : la dictée vient le compléter, pas le remplacer. */
  async function beginListening(): Promise<void> {
    setError(null)
    setVoiceHint(null)
    setSuggestOpen(false)
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

  async function handleOpen(): Promise<void> {
    setAnswer(null)
    await beginListening()
  }

  /** Basculer vers la voix depuis la saisie : le texte déjà écrit est conservé et complété par la dictée. */
  async function handleDictateMore(): Promise<void> {
    setAnswer(null)
    await beginListening()
  }

  /**
   * Fin d'écoute. `send` : on envoie (voix seule, ou texte + voix concaténés) ;
   * `review` : on repose le texte combiné dans le champ pour le relire/continuer.
   */
  async function finishListening(onResult: "send" | "review"): Promise<void> {
    const recording = recordingRef.current
    if (!recording) return
    recordingRef.current = null
    setPhase("transcribing")
    let text: string
    try {
      const audio = await recording.stop()
      text = isSilent(audio) ? "" : await window.api.speech.transcribe(audio)
    } catch (err) {
      fallBackToTyping(`Transcription impossible (${cleanIpcErrorMessage(err)}) — écrivez votre question.`)
      return
    }
    const prefix = typedText.trim()
    if (!text) {
      fallBackToTyping(
        prefix
          ? "Je n'ai rien entendu — votre question écrite est conservée, continuez-la."
          : "Je n'ai rien entendu — réessayez avec Espace ou écrivez votre question.",
      )
      return
    }
    const combined = prefix ? `${prefix} ${text}`.trim() : text
    if (onResult === "send") {
      await ask(combined)
      return
    }
    // Fusion voix/texte : la question combinée reste modifiable avant l'envoi.
    setTypedText(combined)
    setSuggestOpen(false)
    setCaretAtEnd(true)
    setPhase("typing")
  }

  function handleStopListening(): void {
    void finishListening("send")
  }

  function handleReviewListening(): void {
    void finishListening("review")
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
      // Écran rendu inerte par une fenêtre modale (voir DayView) : les raccourcis ne partent pas derrière elle.
      if (rootRef.current?.closest("[inert]")) return
      if (phase === "answered" || phase === "error") {
        if (!isEditableTarget(event.target)) handleAnsweredKey(event)
        return
      }
      if (event.repeat || isEditableTarget(event.target)) return
      if (event.code === "Space" && (phase === "idle" || phase === "listening")) {
        event.preventDefault()
        if (phase === "idle") void handleOpen()
        else handleStopListening()
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
    setSuggestOpen(false)
  }

  function handleSubmitTyped(): void {
    if (!typedText.trim()) return
    void ask(typedText.trim())
  }

  function handleTypedKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    // Tab accepte la complétion fantôme quand elle est affichée ; sinon il garde son rôle (focus).
    if (event.key === "Tab" && ghost && !event.shiftKey) {
      event.preventDefault()
      setTypedText(typedText + ghost)
      setCaretAtEnd(true)
      return
    }
    if (suggestVisible) {
      const count = liveSuggestions.length
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // Sans preventDefault, le curseur sauterait en début/fin de champ.
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setSuggestIndex((current) => (current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count))
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        const selected = suggestIndex >= 0 ? liveSuggestions[suggestIndex] : undefined
        if (selected) chooseSuggestion(selected)
        else handleSubmitTyped()
        return
      }
      if (event.key === "Escape") {
        // Échap ne ferme que la liste : le même événement ne doit atteindre ni la fermeture du panneau
        // ni le listener `window`.
        event.preventDefault()
        event.stopPropagation()
        setSuggestOpen(false)
        setSuggestIndex(-1)
        return
      }
    }
    if (event.key === "Enter") handleSubmitTyped()
    else if (event.key === "Escape") handleClose()
    else if (event.key === "ArrowUp" && typedText === "" && lastQuestion) {
      event.preventDefault()
      // Le rappel n'est pas une frappe : la liste reste fermée jusqu'à la prochaine saisie.
      setSuggestOpen(false)
      setTypedText(lastQuestion)
    }
  }

  if (phase === "idle") {
    return (
      <div className="dayview-talk-idle" ref={rootRef}>
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
    <div className="dayview-talk-panel" ref={rootRef}>
      {phase === "listening" && (
        <>
          <p className="dayview-talk-status">
            <span className="dayview-talk-live-dot" aria-hidden="true" />
            Je vous écoute…
          </p>
          {typedText.trim() !== "" && (
            <p className="dayview-talk-echo">La dictée s&apos;ajoutera à « {typedText.trim()} »</p>
          )}
          <div className="dayview-talk-listen-actions">
            <button
              type="button"
              className="onboarding-button onboarding-button--primary"
              onClick={handleStopListening}
            >
              Envoyer
            </button>
            <button type="button" className="onboarding-link" onClick={handleReviewListening}>
              Écrire la suite
            </button>
          </div>
          <p className="dayview-talk-kbd-hint">
            <kbd className="dayview-kbd">Espace</kbd> pour envoyer, ou « Écrire la suite » pour compléter à la main
          </p>
        </>
      )}

      {phase === "transcribing" && <p className="dayview-talk-status">Transcription…</p>}

      {phase === "typing" && (
        <div className="dayview-talk-input-group">
          {voiceHint && <p className="dayview-talk-voice-hint">{voiceHint}</p>}
          <div className="dayview-talk-input-row">
            <div className="dayview-talk-field">
              <input
                className="onboarding-input dayview-talk-input"
                type="text"
                placeholder="Écrivez votre question à BCC…"
                value={typedText}
                autoFocus
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestVisible}
                aria-controls={suggestListId}
                aria-activedescendant={
                  suggestVisible && suggestIndex >= 0 ? `${suggestListId}-${suggestIndex}` : undefined
                }
                onChange={(event) => {
                  setTypedText(event.target.value)
                  setSuggestOpen(true)
                  setSuggestIndex(-1)
                  setCaretAtEnd(event.target.selectionStart === event.target.value.length)
                }}
                onSelect={(event) => {
                  const field = event.currentTarget
                  setCaretAtEnd(field.selectionStart === field.value.length)
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => {
                  setSuggestOpen(false)
                  setInputFocused(false)
                }}
                onKeyDown={handleTypedKey}
              />
              {ghost && (
                <div className="dayview-talk-ghost" aria-hidden="true">
                  <span className="dayview-talk-ghost-typed">{typedText}</span>
                  <span className="dayview-talk-ghost-suffix">{ghost}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="dayview-talk-mic-button"
              onClick={() => void handleDictateMore()}
              aria-label="Dicter la suite"
              title="Dicter la suite — votre texte écrit est conservé"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="6" y="1.5" width="4" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button type="button" className="onboarding-button onboarding-button--primary" onClick={handleSubmitTyped}>
              Envoyer
            </button>
          </div>
          {ghost && (
            <p className="dayview-talk-kbd-hint">
              <kbd className="dayview-kbd">Tab</kbd> pour compléter
            </p>
          )}
          <ul
            id={suggestListId}
            role="listbox"
            aria-label="Suggestions"
            className="dayview-talk-suggest"
            hidden={!suggestVisible}
          >
            {suggestVisible &&
              liveSuggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`${suggestListId}-${index}`}
                  role="option"
                  aria-selected={index === suggestIndex}
                  className={
                    index === suggestIndex
                      ? "dayview-talk-suggest-item dayview-talk-suggest-item--selected"
                      : "dayview-talk-suggest-item"
                  }
                  title={suggestion.learned ? "Raccourci appris sur cet appareil" : undefined}
                  // Sans ça, le mousedown ôte le focus au champ : blur → liste fermée avant que le clic n'arrive.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSuggestIndex(index)}
                  onClick={() => chooseSuggestion(suggestion)}
                >
                  <span className={`dayview-talk-suggest-kind dayview-talk-suggest-kind--${suggestion.kind}`}>
                    {SUGGESTION_KIND_LABEL[suggestion.kind]}
                  </span>
                  <span className="dayview-talk-suggest-text">
                    <span className="dayview-talk-suggest-label">
                      {suggestion.learned && (
                        <span className="dayview-talk-suggest-learned" aria-hidden="true">
                          ★{" "}
                        </span>
                      )}
                      {suggestion.label}
                    </span>
                    {suggestion.detail && <span className="dayview-talk-suggest-detail">{suggestion.detail}</span>}
                  </span>
                </li>
              ))}
          </ul>
          {typedText.trim() === "" && (
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
          )}
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
