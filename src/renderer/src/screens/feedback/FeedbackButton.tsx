import { useEffect, useRef, useState } from "react"
import { FEEDBACK_MAX_CHARS } from "@shared/feedback"
import { cleanIpcErrorMessage } from "@renderer/lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import "./feedback.css"

/**
 * Retour utilisateur (contrat : docs/ipc/feedback.md), présent en bas à gauche de tous les écrans. Le texte saisi est
 * remis à main, qui ouvre un retour prérempli dans le navigateur : l'utilisateur le relit et le valide là-bas.
 */
function FeedbackButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Fermeture : clic à l'extérieur ou Échap (le focus revient sur le bouton). Le texte en cours est conservé.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (busy || message.trim() === "") return
    setBusy(true)
    setError(null)
    try {
      await window.api.feedback.send(message)
      // Le texte reste dans le champ : l'ouverture du navigateur ne garantit pas que le retour a été validé là-bas.
      setSent(true)
      playSfx("tick")
    } catch (err) {
      setError(cleanIpcErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="feedback" ref={rootRef}>
      {open && (
        <form className="feedback-panel" aria-label="Donner un retour" onSubmit={(event) => void handleSubmit(event)}>
          <p className="feedback-title">Un retour sur Byko ?</p>
          <textarea
            ref={inputRef}
            className="feedback-input"
            placeholder="Ce qui vous a gêné, manqué ou plu…"
            aria-label="Votre retour"
            rows={4}
            maxLength={FEEDBACK_MAX_CHARS}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value)
              setSent(false)
            }}
            // Espace et « T » pilotent « Parler à Byko » sur la vue journée : la saisie ne doit pas les déclencher.
            onKeyDown={(event) => event.stopPropagation()}
          />
          <p className="feedback-hint" role="status">
            {sent
              ? "Votre navigateur s'est ouvert sur le retour prérempli : validez-le là-bas pour l'envoyer. Merci !"
              : "Votre navigateur s'ouvrira sur un retour prérempli (GitHub) : seuls ce texte, la version et votre système y figurent."}
          </p>
          {error && (
            <p className="feedback-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="feedback-submit" disabled={busy || message.trim() === ""}>
            Envoyer
          </button>
        </form>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="feedback-trigger"
        aria-expanded={open}
        onClick={() => {
          playSfx("tick")
          setOpen(!open)
        }}
      >
        Un retour ?
      </button>
    </div>
  )
}

export default FeedbackButton
