"use client";

import { useEffect, useState } from "react";

import type {
  ComparisonWindow,
  CostLevel,
  ScopeCountResponse,
} from "@/lib/types/analysis";
import {
  DEFAULT_COMPARISON_WINDOW,
  WINDOW_OPTIONS,
  formatScopeCount,
} from "@/lib/workspace";
import styles from "./window-slider.module.css";

/**
 * FRONT-8 — curseur à 5 crans + comptage en direct.
 *
 * À chaque changement de palier, `GET /api/analysis/scope-count` est rappelé (debounce
 * ~300 ms, FRONT-8) et le badge « N tickets · Coût X » se met à jour — SANS lancer
 * d'analyse IA. Jamais de valeur intermédiaire : 5 positions fixes.
 *
 * État replié (barre compacte sur les écrans de résultat) / déplié (sur la pré-analyse) :
 * mémorisé pendant la session via l'état local (le composant reste monté tant que l'espace
 * de travail l'est — pas de persistance long terme, conforme à la fiche).
 */

export function WindowSlider({
  mode,
  ticketKey,
  scopeHint,
  initialWindow,
  onWindowChange,
}: {
  mode: "jira" | "manual";
  ticketKey?: string;
  scopeHint?: string;
  initialWindow?: ComparisonWindow;
  onWindowChange?: (window: ComparisonWindow) => void;
}) {
  const [window, setWindow] = useState<ComparisonWindow>(
    initialWindow ?? DEFAULT_COMPARISON_WINDOW,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [costLevel, setCostLevel] = useState<CostLevel | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setComputing(true);
      setError(null);
      const params = new URLSearchParams({ comparisonWindow: window });
      if (mode === "jira" && ticketKey !== undefined) {
        params.set("ticketKey", ticketKey);
      }
      if (scopeHint !== undefined && scopeHint.trim() !== "") {
        params.set("scopeHint", scopeHint.trim());
      }
      void fetch(`/api/analysis/scope-count?${params.toString()}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((body: ScopeCountResponse) => {
          if (cancelled) return;
          if (body.status === "success") {
            setCount(body.count);
            setCostLevel(body.costLevel);
          } else {
            setCount(null);
            setCostLevel(null);
            setError(body.message);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCount(null);
            setCostLevel(null);
            setError("Le comptage n'a pas pu joindre le serveur. Réessayez.");
          }
        })
        .finally(() => {
          if (!cancelled) setComputing(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, ticketKey, scopeHint, window]);

  const pick = (next: ComparisonWindow) => {
    setWindow(next);
    onWindowChange?.(next);
  };

  if (collapsed) {
    return (
      <button type="button" className={styles.collapsedBar} onClick={() => setCollapsed(false)}>
        <span className={styles.collapsedLabel}>
          Fenêtre : {WINDOW_OPTIONS.find((option) => option.value === window)?.label}
        </span>
        {computing ? (
          <span className={styles.badge}>Comptage…</span>
        ) : count !== null && costLevel !== null ? (
          <span className={styles.badge}>{formatScopeCount(count, costLevel)}</span>
        ) : null}
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <p className={styles.title}>Fenêtre de comparaison</p>
      <div className={styles.detents} role="radiogroup" aria-label="Fenêtre de comparaison">
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={window === option.value}
            className={window === option.value ? styles.detentActive : styles.detent}
            onClick={() => pick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className={styles.statusRow}>
        {computing ? (
          <span className={styles.statusText}>Comptage du périmètre…</span>
        ) : error !== null ? (
          <span className={styles.statusError}>{error}</span>
        ) : count !== null && costLevel !== null ? (
          <span className={styles.badge}>{formatScopeCount(count, costLevel)}</span>
        ) : null}
        <button type="button" className={styles.collapseLink} onClick={() => setCollapsed(true)}>
          Réduire
        </button>
      </div>
    </div>
  );
}
