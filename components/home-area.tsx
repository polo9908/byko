"use client";

import { useState } from "react";

import { SettingsModal } from "@/components/settings-modal";
import { WorkspaceScreen } from "@/components/workspace-screen";
import styles from "./home-area.module.css";

/**
 * FRONT-6/FRONT-7 — zone principale post-onboarding : en-tête d'application (wordmark +
 * bouton Paramètres, présent sur tous les écrans) et espace de travail (FRONT-7).
 * Le bouton Paramètres ouvre la modale (FRONT-11/12) par-dessus ce contenu, qui reste
 * monté et inchangé derrière l'overlay.
 */

export function HomeArea() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            b
          </span>
          <span className={styles.brandName}>byko</span>
        </div>
        <button
          type="button"
          className={styles.settingsButton}
          onClick={() => setModalOpen(true)}
        >
          Paramètres
        </button>
      </header>

      <div className={styles.workspace}>
        <WorkspaceScreen />
      </div>

      {modalOpen && <SettingsModal onClose={() => setModalOpen(false)} />}
    </main>
  );
}
