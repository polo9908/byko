import { useEffect, useMemo, useRef, useState } from "react"
import { BUILTIN_GLOSSARY } from "@shared/glossaryBuiltin"
import { GLOSSARY_ALIAS_MAX, GLOSSARY_MEANING_MAX, GLOSSARY_SQUAD_MAX, GLOSSARY_TERM_MAX } from "@shared/glossary"
import type { GlossaryState } from "@shared/glossary"
import { cleanIpcErrorMessage } from "../../lib/ipcError"
import { playSfx } from "@renderer/lib/sound"
import Switch from "./Switch"

const BROWSE_LIMIT = 40

/**
 * Vocabulaire des réunions (contrat : docs/ipc/glossary.md) : base livrée avec BYKO (Agile, Scrum, IT, architecture,
 * design, en français et en anglais) + liste de l'utilisateur. Il sert à corriger les erreurs de transcription et à
 * expliquer les abréviations à l'IA ; la reconnaissance vocale elle-même n'est pas modifiée.
 */
function VocabularySection(): React.JSX.Element {
  const [state, setState] = useState<GlossaryState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [term, setTerm] = useState("")
  const [meaning, setMeaning] = useState("")
  const [aliases, setAliases] = useState("")
  const [squad, setSquad] = useState("")
  const [importText, setImportText] = useState("")
  const [browsing, setBrowsing] = useState(false)
  const [query, setQuery] = useState("")
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.api.glossary
      .get()
      .then((next) => {
        if (mountedRef.current) setState(next)
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setError(`Impossible de lire le vocabulaire : ${cleanIpcErrorMessage(err)}`)
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function run(action: () => Promise<GlossaryState | null>): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await action()
      if (mountedRef.current && next) setState(next)
      playSfx("tick")
      return true
    } catch (err) {
      if (mountedRef.current) setError(cleanIpcErrorMessage(err))
      return false
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  async function handleAdd(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const variants = aliases
      .split(",")
      .map((alias) => alias.trim())
      .filter((alias) => alias !== "")
    const done = await run(() =>
      window.api.glossary.add({
        term,
        ...(meaning.trim() ? { meaning } : {}),
        aliases: variants,
        ...(squad.trim() ? { squad } : {}),
      }),
    )
    if (done) {
      setTerm("")
      setMeaning("")
      setAliases("")
      // L'équipe reste saisie : on range souvent plusieurs termes de la même équipe à la suite.
    }
  }

  async function handleImport(): Promise<void> {
    let message = ""
    const done = await run(async () => {
      const { state: next, result } = await window.api.glossary.import(importText)
      message =
        result.added === 0
          ? "Aucun terme reconnu dans cette liste."
          : `${result.added} terme${result.added > 1 ? "s" : ""} ajouté${result.added > 1 ? "s" : ""}` +
            (result.skipped > 0 ? ` · ${result.skipped} ligne${result.skipped > 1 ? "s" : ""} ignorée${result.skipped > 1 ? "s" : ""}` : "")
      return next
    })
    if (done) {
      setNotice(message)
      setImportText("")
    }
  }

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? BUILTIN_GLOSSARY.filter(
          (entry) => entry.term.toLowerCase().includes(needle) || entry.meaning.toLowerCase().includes(needle),
        )
      : BUILTIN_GLOSSARY
    return { shown: list.slice(0, BROWSE_LIMIT), total: list.length }
  }, [query])

  return (
    <>
      <p className="settings-section-label">Vocabulaire de base</p>
      <div className="settings-row settings-privacy-row">
        <div className="settings-row-info">
          <span className="settings-privacy-label" id="settings-vocab-builtin-label">
            Reconnaître le vocabulaire courant
          </span>
          <span className="settings-row-subtitle" id="settings-vocab-builtin-help">
            {state ? `${state.builtinCount} termes` : "…"} d&apos;Agile, Scrum, IT, développement, architecture et design, en
            français et en anglais, abréviations comprises (PO, DoD, CI/CD, MEP…).
          </span>
        </div>
        {state && (
          <Switch
            checked={state.builtinEnabled}
            onChange={(next) => void run(() => window.api.glossary.setBuiltinEnabled(next))}
            labelledBy="settings-vocab-builtin-label"
            describedBy="settings-vocab-builtin-help"
            disabled={busy}
          />
        )}
      </div>
      <div className="settings-row">
        <button type="button" className="settings-guide-toggle" onClick={() => setBrowsing(!browsing)} aria-expanded={browsing}>
          {browsing ? "Masquer le vocabulaire de base" : "Parcourir le vocabulaire de base"}
        </button>
      </div>
      {browsing && (
        <div className="settings-vocab-browser">
          <input
            type="search"
            className="settings-detail-input"
            placeholder="Chercher un terme ou une signification"
            aria-label="Chercher dans le vocabulaire de base"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="settings-vocab-list">
            {found.shown.map((entry) => (
              <li key={entry.term}>
                <strong>{entry.term}</strong>
                <span>{entry.meaning}</span>
              </li>
            ))}
          </ul>
          <p className="settings-detail-hint">
            {found.total > found.shown.length
              ? `${found.shown.length} sur ${found.total} — précisez la recherche pour voir les autres.`
              : `${found.total} résultat${found.total > 1 ? "s" : ""}.`}
          </p>
        </div>
      )}

      <p className="settings-section-label">Mon vocabulaire</p>
      <form className="settings-vocab-form" onSubmit={(event) => void handleAdd(event)}>
        <input
          className="settings-detail-input"
          placeholder="Abréviation ou expression (ex. ZQ, sprint zéro)"
          aria-label="Abréviation ou expression"
          maxLength={GLOSSARY_TERM_MAX}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <input
          className="settings-detail-input"
          placeholder="Ce que ça veut dire (facultatif)"
          aria-label="Signification"
          maxLength={GLOSSARY_MEANING_MAX}
          value={meaning}
          onChange={(event) => setMeaning(event.target.value)}
        />
        <input
          className="settings-detail-input"
          placeholder={`Souvent mal transcrit en… (facultatif, séparé par des virgules, ${GLOSSARY_ALIAS_MAX} maximum)`}
          aria-label="Variantes mal transcrites"
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
        />
        <input
          className="settings-detail-input"
          placeholder="Propre à une équipe ? Son nom (facultatif — vide : commun à tous)"
          aria-label="Équipe à laquelle le terme est propre"
          maxLength={GLOSSARY_SQUAD_MAX}
          value={squad}
          onChange={(event) => setSquad(event.target.value)}
        />
        <button type="submit" className="settings-connect-button" disabled={busy || term.trim() === ""}>
          Ajouter
        </button>
      </form>
      {state && state.entries.length === 0 && (
        <p className="settings-detail-hint settings-vocab-hint">
          Rien pour l&apos;instant. Ajoutez les sigles et expressions propres à votre équipe : ils seront corrigés dans la
          transcription et expliqués à l&apos;IA.
        </p>
      )}
      {state?.entries.map((entry) => (
        <div className="settings-row" key={entry.id}>
          <div className="settings-row-info">
            <span className="settings-row-name">
              {entry.term}
              {entry.squad ? ` · Équipe ${entry.squad}` : ""}
            </span>
            <span className="settings-row-subtitle">
              {[entry.meaning, entry.aliases.length > 0 ? `mal transcrit : ${entry.aliases.join(", ")}` : ""]
                .filter(Boolean)
                .join(" — ") || "Sans signification"}
            </span>
          </div>
          <button
            type="button"
            className="settings-guide-toggle"
            disabled={busy}
            aria-label={`Retirer ${entry.term}`}
            onClick={() => void run(() => window.api.glossary.remove(entry.id))}
          >
            Retirer
          </button>
        </div>
      ))}

      <p className="settings-section-label">Importer une liste</p>
      <div className="settings-vocab-import">
        <textarea
          className="settings-detail-input settings-vocab-textarea"
          aria-label="Liste de vocabulaire à importer"
          placeholder={"DoD = Definition of Done\nKPI ; indicateur clé de performance ; k p i\n# une ligne par terme"}
          rows={5}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
        />
        <p className="settings-detail-hint">
          Une ligne par terme : <code>terme = signification</code> ou <code>terme ; signification ; variante | variante</code>.
          Un terme déjà présent est mis à jour.
        </p>
        <button type="button" className="settings-connect-button" disabled={busy || importText.trim() === ""} onClick={() => void handleImport()}>
          Importer
        </button>
      </div>

      <div className="settings-privacy-help">
        <p className="settings-detail-hint settings-privacy-text">
          Le vocabulaire corrige les erreurs de transcription connues (« dev ops » devient « DevOps ») et explique les
          abréviations à votre IA, uniquement celles qui apparaissent dans la réunion. Il est propre à chaque compte et reste
          sur cet appareil ; la reconnaissance vocale elle-même n&apos;est pas modifiée.
        </p>
      </div>
      {notice && (
        <p className="settings-detail-hint settings-vocab-hint" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="settings-detail-error settings-vocab-hint" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

export default VocabularySection
