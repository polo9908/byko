"use client";

import { useEffect, useRef } from "react";

import pkg from "../package.json";
import { ConnexionsScreen } from "./connexions-screen";
import styles from "./settings-modal.module.css";

/**
 * FRONT-11/FRONT-12 — modale Paramètres.
 *
 * FRONT-11 (structure) : overlay sombre sur le contenu en arrière-plan (qui reste monté,
 * inchangé), grande modale centrée (~680px), en-tête avec nom de l'app + version + bouton
 * fermer. Fermeture par le bouton croix, clic sur l'overlay ou touche Échap. Piège à focus
 * clavier pendant l'ouverture ; le focus revient à l'élément d'origine à la fermeture.
 *
 * FRONT-12 (contenu) : la section Connexions réutilise les blocs partagés (ARCHI-6) via
 * `ConnexionsScreen` en contexte `embedded` — mêmes composants et même logique de test que
 * le wizard, aucune duplication (critère d'acceptation).
 */

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = dialogRef.current;
    const focusableElements = (): HTMLElement[] => {
      if (!container) return [];
      return Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const items = focusableElements();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !container?.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    container?.querySelector<HTMLElement>("[data-modal-close]")?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Paramètres"
      >
        <header className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>Application</p>
            <h1 className={styles.title}>Paramètres</h1>
          </div>
          <span className={styles.version}>v{pkg.version}</span>
          <button
            type="button"
            className={styles.closeButton}
            data-modal-close
            aria-label="Fermer les paramètres"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className={styles.dialogBody}>
          <ConnexionsScreen variant="params" embedded />
        </div>
      </div>
    </div>
  );
}
