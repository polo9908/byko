"use client";

import { useEffect, useState } from "react";

import { IntroScreen } from "@/components/intro-screen";
import { resolveHomeView, type HomeGate } from "@/lib/home-gate";
import type { GetSettingsResponse } from "@/lib/types/settings";
import styles from "./home.module.css";

/**
 * FRONT-1 — page d'accueil.
 *
 * Orchestrateur minimal : au montage, lit l'état réel de la configuration
 * (`GET /api/settings`) et aiguille la vue d'accueil (cf. `lib/home-gate.ts`) :
 * - Intro au premier lancement (marqueur `onboardingCompleted` à `false`) ;
 * - écran Connexions après la barre de progression de l'Intro (squelette : implémenté par
 *   FRONT-2) ;
 * - espace principal si la configuration initiale est déjà terminée (FRONT-7 à venir) ;
 * - message d'erreur du backend si la lecture échoue — jamais confondu avec un état vide.
 */

const UNREADABLE_MESSAGE =
  "Impossible de lire l'état de la configuration. Réessayez dans un instant.";

async function fetchGate(): Promise<HomeGate> {
  try {
    const response = await fetch("/api/settings", { cache: "no-store" });
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { status?: unknown }).status !== "string"
    ) {
      throw new Error("Réponse illisible");
    }
    return resolveHomeView(body as GetSettingsResponse);
  } catch {
    return { view: "error", message: UNREADABLE_MESSAGE };
  }
}

export default function Home() {
  const [gate, setGate] = useState<HomeGate | null>(null);
  const [introFinished, setIntroFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchGate().then((next) => {
      if (!cancelled) setGate(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const retry = () => {
    setGate(null);
    void fetchGate().then(setGate);
  };

  const view = gate?.view ?? "loading";

  if (view === "loading") {
    return <main aria-hidden="true" />;
  }

  if (view === "intro" && !introFinished) {
    return <IntroScreen onDone={() => setIntroFinished(true)} />;
  }

  if (view === "intro") {
    return (
      <main className={styles.screen}>
        <div className={styles.stack}>
          <p className={styles.eyebrow}>Configuration</p>
          <h1 className={styles.title}>Connexions</h1>
          <p className={styles.note}>
            Vous connecterez ici Jira, Figma et votre modèle IA. Cet écran sera construit
            par le prochain lot.
          </p>
        </div>
      </main>
    );
  }

  if (view === "main") {
    return (
      <main className={styles.screen}>
        <div className={styles.stack}>
          <p className={styles.eyebrow}>byko</p>
          <h1 className={styles.title}>Votre espace de travail</h1>
          <p className={styles.note}>
            La configuration initiale est terminée. Les écrans d&apos;analyse de tickets
            arrivent avec les prochains lots.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <div className={styles.stack}>
        <p className={styles.eyebrow}>Erreur</p>
        <h1 className={styles.title}>Lecture impossible</h1>
        <p className={styles.note}>{gate?.message}</p>
        <button type="button" className={styles.retry} onClick={retry}>
          Réessayer
        </button>
      </div>
    </main>
  );
}
