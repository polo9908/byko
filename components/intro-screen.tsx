"use client";

import { useEffect } from "react";
import styles from "./intro-screen.module.css";

/**
 * FRONT-1 — écran Intro (tout premier lancement).
 *
 * Affiche logo + nom + message d'accueil, puis une barre de progression animée qui se
 * remplit sur 3 secondes ; au terme de l'animation, `onDone` est appelé et le flux
 * passe à l'écran suivant (Connexions, FRONT-2). Le délai est un vrai `setTimeout`
 * nettoyé au démontage, indépendant de la fin d'une animation CSS (qui n'est pas fiable
 * si l'onglet est inactif ou l'animation réduite).
 *
 * V1 volontairement sobre (validation utilisateur du 06/09/2026) : moodboard orange /
 * beige, mise en page aérée, police Manrope en graisses légères. Le texte est regroupé
 * en constantes en tête de fichier pour être ajusté sans chercher dans le JSX.
 */

const APP_NAME = "byko";
const APP_DESCRIPTOR = "Business Context Checker";
const WELCOME_MESSAGE =
  "Configurez vos connexions pour analyser vos tickets avant de les démarrer.";
const INTRO_DURATION_MS = 3000;

export function IntroScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, INTRO_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <main className={styles.screen}>
      <div className={styles.content}>
        <div className={styles.mark} aria-hidden="true">
          <span className={styles.markLetter}>b</span>
        </div>
        <p className={styles.descriptor}>{APP_DESCRIPTOR}</p>
        <h1 className={styles.appName}>{APP_NAME}</h1>
        <p className={styles.message}>{WELCOME_MESSAGE}</p>
        <div className={styles.progress} role="progressbar" aria-hidden="true">
          <div className={styles.progressFill} />
        </div>
      </div>
    </main>
  );
}
