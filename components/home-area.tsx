"use client";

import { useEffect, useState } from "react";

import { SettingsModal } from "@/components/settings-modal";
import type { GetSettingsResponse, SettingsState } from "@/lib/types/settings";
import styles from "./home-area.module.css";

/**
 * FRONT-6 — zone principale après l'onboarding (espace de travail en attente de FRONT-7).
 *
 * Porte l'en-tête d'application (wordmark + bouton Paramètres) présent sur tous les écrans
 * post-onboarding, et l'état « rien configuré » : si ni Jira ni le modèle IA ne sont
 * connectés, un message visible invite à aller dans Paramètres (un ticket pourra être collé
 * manuellement sans connexion, cf. FRONT-7). L'état Figma y est aussi lu, pour préparer
 * l'emplacement du message « composants » de la phase suivante.
 *
 * Le bouton Paramètres ouvre la modale (FRONT-11/12) par-dessus ce contenu, qui reste monté
 * et inchangé derrière l'overlay.
 */

const UNREADABLE_MESSAGE =
  "Impossible de lire l'état de la configuration. Réessayez dans un instant.";

export function HomeArea() {
  const [attempt, setAttempt] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const closeSettings = () => {
    setModalOpen(false);
    // Les connexions peuvent avoir changé dans la modale : on relit l'état réel.
    setAttempt((current) => current + 1);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null) {
          throw new Error("Réponse illisible");
        }
        const parsed = body as GetSettingsResponse;
        if (parsed.status !== "success") {
          throw new Error(parsed.message);
        }
        if (!cancelled) {
          setSettings(parsed.settings);
          setErrorMessage(null);
        }
      } catch {
        if (!cancelled) setErrorMessage(UNREADABLE_MESSAGE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const nothingConfigured =
    settings !== null &&
    settings.jira.status !== "connected" &&
    settings.ai.status !== "connected";

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

      <div className={styles.body}>
        {errorMessage !== null ? (
          <div className={styles.centerStack}>
            <p className={styles.note}>{errorMessage}</p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setAttempt((current) => current + 1)}
            >
              Réessayer
            </button>
          </div>
        ) : settings === null ? (
          <div aria-hidden="true" />
        ) : nothingConfigured ? (
          <div className={styles.centerStack}>
            <p className={styles.eyebrow}>Bienvenue</p>
            <h1 className={styles.title}>Vos connexions ne sont pas encore configurées</h1>
            <p className={styles.note}>
              Vous pourrez coller un ticket manuellement sans aucune connexion. Pour
              l&apos;analyse complète, connectez Jira et votre modèle IA : ouvrez les
              Paramètres.
            </p>
            {settings.figma.status !== "connected" && (
              <p className={styles.noteSmall}>
                Les recommandations de composants Figma s&apos;activeront une fois Figma
                connecté.
              </p>
            )}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setModalOpen(true)}
            >
              Ouvrir les Paramètres
            </button>
          </div>
        ) : (
          <div className={styles.centerStack}>
            <p className={styles.eyebrow}>byko</p>
            <h1 className={styles.title}>Votre espace de travail</h1>
            <p className={styles.note}>
              La configuration est en place. Les écrans d&apos;analyse de tickets arrivent
              avec les prochains lots.
            </p>
          </div>
        )}
      </div>

      {modalOpen && <SettingsModal onClose={closeSettings} />}
    </main>
  );
}
