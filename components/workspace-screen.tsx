"use client";

import { useEffect, useState } from "react";

import { WindowSlider } from "@/components/window-slider";
import type { ComparisonWindow } from "@/lib/types/analysis";
import type { AnalysisStreamEvent } from "@/lib/types/analysis";
import type { GetTicketsResponse, TicketListItem } from "@/lib/types/tickets";
import { DEFAULT_COMPARISON_WINDOW, priorityFlagColor } from "@/lib/workspace";
import styles from "./workspace-screen.module.css";

/**
 * FRONT-7 — espace de travail (liste de gauche + panneau du ticket + curseur FRONT-8).
 *
 * - Jira connecté : liste des tickets (ordre serveur Jira, jamais réordonné par le statut
 *   d'analyse), recherche, toggle « Déjà analysés » (flag `alreadyAnalyzed` de BACK-10),
 *   premier ticket auto-sélectionné, fanion coloré par priorité.
 * - Jira non connecté : la liste est remplacée par le formulaire de saisie manuelle
 *   (contenu + champ « Epic / composant » optionnel).
 * - Le panneau central porte le curseur FRONT-8 (fenêtre + comptage) et l'action d'analyse :
 *   bouton « Relancer l'analyse » grisé tant que la fenêtre n'a pas changé depuis la
 *   dernière analyse (FRONT-8). L'écran de résultat arrive avec FRONT-9 : le retour de
 *   l'analyse s'affiche ici en note d'attente.
 */

const ANALYZE_UNREACHABLE =
  "L'analyse n'a pas pu joindre le serveur. Réessayez dans un instant.";

export function WorkspaceScreen() {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jiraConnected, setJiraConnected] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [search, setSearch] = useState("");
  const [onlyAnalyzed, setOnlyAnalyzed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [manualText, setManualText] = useState("");
  const [manualScope, setManualScope] = useState("");
  const [window, setWindow] = useState<ComparisonWindow>(DEFAULT_COMPARISON_WINDOW);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisNote, setAnalysisNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [lastRunWindow, setLastRunWindow] = useState<ComparisonWindow | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tickets", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: GetTicketsResponse) => {
        if (cancelled) return;
        if (body.status === "error") {
          setError(body.message);
          return;
        }
        setJiraConnected(body.jiraConnected);
        setTickets(body.tickets);
        setError(null);
        if (body.tickets.length > 0) {
          setSelectedKey((current) => current ?? body.tickets[0].key);
        }
      })
      .catch(() => {
        if (!cancelled) setError("La liste des tickets n'a pas pu être chargée.");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const visibleTickets = tickets.filter((ticket) => {
    const matchesSearch =
      search.trim() === "" ||
      ticket.key.toLowerCase().includes(search.toLowerCase()) ||
      ticket.summary.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = !onlyAnalyzed || ticket.alreadyAnalyzed;
    return matchesSearch && matchesFilter;
  });

  const selected =
    selectedKey === null ? null : tickets.find((ticket) => ticket.key === selectedKey) ?? null;

  const unchangedSinceRun =
    lastRunWindow !== null && lastRunWindow === window;
  const canAnalyze = !analyzing && !unchangedSinceRun;

  const analyze = async () => {
    const body =
      jiraConnected === true
        ? selected === null
          ? null
          : {
              ticketSource: "jira" as const,
              ticketKey: selected.key,
              comparisonWindow: window,
            }
        : manualText.trim() === ""
          ? null
          : {
              ticketSource: "manual" as const,
              ticketText: manualText.trim(),
              comparisonWindow: window,
              scopeHint: manualScope.trim() === "" ? undefined : manualScope.trim(),
            };
    if (body === null) {
      setAnalysisNote({
        kind: "error",
        text:
          jiraConnected === true
            ? "Sélectionnez un ticket pour lancer l'analyse."
            : "Collez d'abord le contenu du ticket à analyser.",
      });
      return;
    }

    setAnalyzing(true);
    setAnalysisNote(null);
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      const events = parseSseEvents(text);
      const terminal = events[events.length - 1];
      if (!response.ok) {
        setAnalysisNote({ kind: "error", text: text || ANALYZE_UNREACHABLE });
      } else if (terminal?.type === "error") {
        setAnalysisNote({ kind: "error", text: terminal.message });
      } else {
        setAnalysisNote({
          kind: "info",
          text: "Analyse terminée. L'écran de résultat arrive avec le prochain lot (FRONT-9).",
        });
      }
      setLastRunWindow(window);
    } catch {
      setAnalysisNote({ kind: "error", text: ANALYZE_UNREACHABLE });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className={styles.screen}>
      <aside className={styles.sidebar}>
        {error !== null ? (
          <div className={styles.sideState}>
            <p className={styles.sideStateText}>{error}</p>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => setAttempt((current) => current + 1)}
            >
              Réessayer
            </button>
          </div>
        ) : jiraConnected === null ? (
          <div className={styles.sideState} aria-hidden="true" />
        ) : jiraConnected === false ? (
          <ManualForm
            text={manualText}
            scope={manualScope}
            onTextChange={setManualText}
            onScopeChange={setManualScope}
          />
        ) : (
          <>
            <div className={styles.listHeader}>
              <h2 className={styles.listTitle}>Tickets</h2>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={onlyAnalyzed}
                  onChange={(event) => setOnlyAnalyzed(event.target.checked)}
                />
                <span>Déjà analysés</span>
              </label>
            </div>
            <input
              type="search"
              className={styles.search}
              placeholder="Rechercher un ticket…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ul className={styles.list}>
              {visibleTickets.map((ticket) => (
                <li key={ticket.key}>
                  <button
                    type="button"
                    className={
                      selectedKey === ticket.key ? styles.rowActive : styles.row
                    }
                    onClick={() => setSelectedKey(ticket.key)}
                  >
                    <span
                      className={styles.flag}
                      aria-hidden="true"
                      style={{
                        borderLeftColor: priorityFlagColor(ticket.priorityName),
                      }}
                    />
                    <span className={styles.rowText}>
                      <span className={styles.rowKey}>{ticket.key}</span>
                      <span className={styles.rowSummary}>{ticket.summary || "—"}</span>
                    </span>
                    {ticket.alreadyAnalyzed && (
                      <span className={styles.analyzedDot} title="Déjà analysé" aria-label="Déjà analysé">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {visibleTickets.length === 0 && (
                <p className={styles.emptyList}>
                  {onlyAnalyzed ? "Aucun ticket déjà analysé." : "Aucun ticket."}
                </p>
              )}
            </ul>
          </>
        )}
      </aside>

      <section className={styles.panel}>
        {jiraConnected === true ? (
          selected === null ? (
            <p className={styles.emptyPanel}>Sélectionnez un ticket pour le préparer.</p>
          ) : (
            <TicketPanel
              ticket={selected}
              manual={false}
              window={window}
              onWindowChange={setWindow}
              hasRun={lastRunWindow !== null}
              analyzing={analyzing}
              canAnalyze={canAnalyze}
              analyze={analyze}
              note={analysisNote}
            />
          )
        ) : jiraConnected === false ? (
          <TicketPanel
            manual={true}
            window={window}
            onWindowChange={setWindow}
            hasRun={lastRunWindow !== null}
            analyzing={analyzing}
            canAnalyze={canAnalyze && manualText.trim() !== ""}
            analyze={analyze}
            note={analysisNote}
          />
        ) : null}
      </section>
    </div>
  );
}

function ManualForm({
  text,
  scope,
  onTextChange,
  onScopeChange,
}: {
  text: string;
  scope: string;
  onTextChange: (value: string) => void;
  onScopeChange: (value: string) => void;
}) {
  return (
    <div className={styles.manualForm}>
      <p className={styles.listTitle}>Saisie manuelle</p>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Contenu du ticket</span>
        <textarea
          className={styles.textarea}
          rows={8}
          placeholder="Collez ici le contenu du ticket à analyser…"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Epic / composant (optionnel)</span>
        <input
          className={styles.input}
          value={scope}
          placeholder="Ex. Paiement"
          onChange={(event) => onScopeChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function TicketPanel({
  ticket,
  manual,
  window,
  onWindowChange,
  hasRun,
  analyzing,
  canAnalyze,
  analyze,
  note,
}: {
  ticket?: TicketListItem;
  manual: boolean;
  window: ComparisonWindow;
  onWindowChange: (window: ComparisonWindow) => void;
  hasRun: boolean;
  analyzing: boolean;
  canAnalyze: boolean;
  analyze: () => void;
  note: { kind: "error" | "info"; text: string } | null;
}) {
  return (
    <div className={styles.ticketPanel}>
      <header className={styles.ticketHeader}>
        {manual ? (
          <>
            <p className={styles.eyebrow}>Saisie manuelle</p>
            <h1 className={styles.ticketTitle}>Ticket collé</h1>
          </>
        ) : ticket === undefined ? null : (
          <>
            <div className={styles.ticketMeta}>
              <span
                className={styles.flagBig}
                aria-hidden="true"
                style={{ borderLeftColor: priorityFlagColor(ticket.priorityName) }}
              />
              <p className={styles.eyebrow}>{ticket.key}</p>
            </div>
            <h1 className={styles.ticketTitle}>{ticket.summary || "Sans résumé"}</h1>
            <p className={styles.ticketPriority}>
              Priorité {ticket.priorityName}
              {ticket.alreadyAnalyzed ? " · déjà analysé" : ""}
            </p>
          </>
        )}
      </header>

      <div className={styles.sliderZone}>
        <WindowSlider
          mode={manual ? "manual" : "jira"}
          ticketKey={manual ? undefined : ticket?.key}
          initialWindow={window}
          onWindowChange={onWindowChange}
        />
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!canAnalyze || analyzing}
          onClick={analyze}
        >
          {analyzing
            ? "Analyse en cours…"
            : hasRun
              ? "Relancer l'analyse"
              : "Analyser le ticket"}
        </button>
      </div>
      {note !== null && (
        <p
          className={note.kind === "error" ? styles.noteError : styles.noteInfo}
          role={note.kind === "error" ? "alert" : "status"}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

/** Extrait les événements SSE (`data: {json}`) d'un corps de réponse. */
export function parseSseEvents(text: string): AnalysisStreamEvent[] {
  const events: AnalysisStreamEvent[] = [];
  for (const match of text.matchAll(/^data: (.+)$/gm)) {
    try {
      const parsed: unknown = JSON.parse(match[1]);
      events.push(parsed as AnalysisStreamEvent);
    } catch {
      // ligne data illisible : ignorée — le terminal d'erreur, s'il existe, porte la vérité.
    }
  }
  return events;
}
