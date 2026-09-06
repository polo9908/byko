"use client";

import { useEffect, useState } from "react";

import type {
  AnalysisStreamEvent,
  ComparisonWindow,
  Verdict,
} from "@/lib/types/analysis";
import type { AnalysisHistoryResponse } from "@/lib/types/analysis";
import {
  VERDICT_HINTS,
  VERDICT_LABELS,
  VERDICT_THEMES,
} from "@/lib/workspace";
import styles from "./result-screen.module.css";

/**
 * FRONT-9 — écran de résultat (verdict, clarification, traduction), en streaming.
 *
 * Reçoit le flux `POST /api/analysis` (ARCHI-4) et affiche chaque section DÈS son arrivée,
 * dans l'ordre verdict → clarification → traduction — pas d'attente bloquante avant le
 * premier affichage (critère d'acceptation). Badge de verdict compact (3 couleurs) + icône
 * « ? » avec infobulle CSS (survol). Le badge « Mis à jour » n'apparaît que si `staleSince`
 * est renvoyé par `GET /api/analysis/history` (BACK-9).
 *
 * « Poster en commentaire Jira » : l'endpoint d'écriture n'existe pas encore — l'action
 * échoue proprement avec un message clair (critère : échec propre si le scope d'écriture
 * manque), jamais en plantage silencieux.
 */

export interface ResultRequest {
  ticketSource: "jira" | "manual";
  ticketKey?: string;
  ticketText?: string;
  comparisonWindow: ComparisonWindow;
  scopeHint?: string;
}

const POST_UNAVAILABLE =
  "La publication en commentaire Jira n'est pas encore disponible (écriture non câblée).";

export function ResultScreen({
  request,
  windowLabel,
  onBack,
}: {
  request: ResultRequest;
  windowLabel: string;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<AnalysisStreamEvent[]>([]);
  const [streaming, setStreaming] = useState(true);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Fraîcheur du dernier résultat connu (BACK-9) — avant le nouveau flux.
    if (request.ticketSource === "jira" && request.ticketKey !== undefined) {
      void fetch(`/api/analysis/history?ticketKey=${encodeURIComponent(request.ticketKey)}`, {
        cache: "no-store",
      })
        .then((response) => response.json())
        .then((body: AnalysisHistoryResponse) => {
          if (!cancelled && body.status === "success" && body.staleness.status === "stale") {
            setStaleSince(body.staleness.staleSince);
          }
        })
        .catch(() => {
          // fraîcheur indisponible : pas de badge, jamais un « à jour » inventé.
        });
    }

    void (async () => {
      try {
        const response = await fetch("/api/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          const text = await response.text();
          if (!cancelled) {
            setEvents([{ type: "error", message: text }]);
            setStreaming(false);
          }
          return;
        }
        if (response.body === null) {
          if (!cancelled) setStreaming(false);
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const line = chunk.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const event = JSON.parse(line.slice(5).trim()) as AnalysisStreamEvent;
              if (!cancelled) setEvents((current) => [...current, event]);
            } catch {
              // ligne illisible ignorée.
            }
          }
        }
      } catch {
        if (!cancelled) {
          setEvents((current) => [...current, { type: "error", message: "L'analyse n'a pas pu joindre le serveur." }]);
        }
      } finally {
        if (!cancelled) setStreaming(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [request]);

  const verdictEvent = events.find(
    (event): event is Extract<AnalysisStreamEvent, { type: "verdict" }> => event.type === "verdict",
  );
  const clarification = events.find(
    (event): event is Extract<AnalysisStreamEvent, { type: "clarification" }> => event.type === "clarification",
  );
  const translation = events.find(
    (event): event is Extract<AnalysisStreamEvent, { type: "translation" }> => event.type === "translation",
  );
  const errorEvent = events.find(
    (event): event is Extract<AnalysisStreamEvent, { type: "error" }> => event.type === "error",
  );

  const copy = async () => {
    if (clarification === undefined) return;
    try {
      await navigator.clipboard.writeText(clarification.message);
      setFeedback({ kind: "info", text: "Message copié." });
    } catch {
      setFeedback({ kind: "error", text: "La copie n'a pas abouti." });
    }
  };

  const postComment = async () => {
    if (clarification === undefined) return;
    setFeedback(null);
    try {
      const response = await fetch("/api/analysis/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketKey: request.ticketKey, message: clarification.message }),
      });
      if (!response.ok) {
        setFeedback({ kind: "error", text: POST_UNAVAILABLE });
        return;
      }
      setFeedback({ kind: "info", text: "Commentaire publié sur Jira." });
    } catch {
      setFeedback({ kind: "error", text: POST_UNAVAILABLE });
    }
  };

  return (
    <div className={styles.result}>
      <button type="button" className={styles.back} onClick={onBack}>
        ← Retour
      </button>

      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            {request.ticketSource === "jira" ? (request.ticketKey ?? "Ticket") : "Saisie manuelle"}
          </h1>
          {verdictEvent !== undefined && <VerdictBadge verdict={verdictEvent.verdict} />}
          {staleSince !== null && (
            <span className={styles.staleBadge} title={`Modifié depuis la dernière analyse (${staleSince}).`}>
              Mis à jour
            </span>
          )}
        </div>
        <p className={styles.windowLine}>Fenêtre : {windowLabel}</p>
      </header>

      {streaming && verdictEvent === undefined && (
        <p className={styles.pending} role="status">
          Analyse en cours…
        </p>
      )}

      {clarification !== undefined && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Clarification</h2>
          <p className={styles.message}>{clarification.message}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void copy()}>
              Copier
            </button>
            {request.ticketSource === "jira" && (
              <button type="button" className={styles.secondaryButton} onClick={() => void postComment()}>
                Poster en commentaire Jira
              </button>
            )}
          </div>
        </section>
      )}

      {translation !== undefined && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Traduction</h2>
          <p className={styles.message}>{translation.text}</p>
        </section>
      )}

      {errorEvent !== undefined && (
        <p className={styles.error} role="alert">
          {errorEvent.message}
        </p>
      )}

      {feedback !== null && (
        <p className={feedback.kind === "error" ? styles.error : styles.feedback} role="status">
          {feedback.text}
        </p>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const theme = VERDICT_THEMES[verdict];
  return (
    <span
      className={styles.verdictBadge}
      style={{ color: theme.color, background: theme.background }}
    >
      {VERDICT_LABELS[verdict]}
      <span className={styles.hintIcon} title={VERDICT_HINTS[verdict]}>
        ?
      </span>
    </span>
  );
}
