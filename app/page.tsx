"use client";

import { useEffect, useState } from "react";

import { ConnexionsScreen } from "@/components/connexions-screen";
import { HomeArea } from "@/components/home-area";
import { IntroScreen } from "@/components/intro-screen";
import { RecapScreen } from "@/components/recap-screen";
import { resolveHomeView, type HomeGate } from "@/lib/home-gate";
import type { GetSettingsResponse, SettingsState } from "@/lib/types/settings";
import styles from "./home.module.css";

/**
 * FRONT-1/FRONT-4/FRONT-5/FRONT-6 — page d'accueil, orchestrateur du flux de configuration.
 *
 * - Intro (FRONT-1) au premier lancement (`onboardingCompleted` à `false`) ;
 * - écran Connexions (FRONT-2/3/4 : accordéon, test au blur, bandeau de blocage,
 *   « Terminer ») ;
 * - écran Récap (FRONT-5), dont le bouton final marque l'onboarding terminé (avenant
 *   BACK-4) — jamais réaffiché ensuite ;
 * - zone principale post-onboarding (FRONT-6) : en-tête d'application avec accès aux
 *   Paramètres — ouverts en modale (FRONT-11/12) par-dessus le contenu — et état
 *   « rien configuré » ;
 * - message d'erreur du backend si la lecture échoue — jamais confondu avec un état vide.
 */

const UNREADABLE_MESSAGE =
  "Impossible de lire l'état de la configuration. Réessayez dans un instant.";

type Phase = "loading" | "intro" | "connexions" | "recap" | "main" | "error";

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
  const [phase, setPhase] = useState<Phase>("loading");
  const [gateError, setGateError] = useState<string | null>(null);
  const [recapSettings, setRecapSettings] = useState<SettingsState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchGate().then((gate) => {
      if (cancelled) return;
      if (gate.view === "error") {
        setGateError(gate.message ?? UNREADABLE_MESSAGE);
        setPhase("error");
        return;
      }
      setPhase(gate.view === "intro" ? "intro" : "main");
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  switch (phase) {
    case "loading":
      return <main aria-hidden="true" />;

    case "intro":
      return <IntroScreen onDone={() => setPhase("connexions")} />;

    case "connexions":
      return (
        <ConnexionsScreen
          variant="wizard"
          onFinish={(settings) => {
            setRecapSettings(settings);
            setPhase("recap");
          }}
        />
      );

    case "recap":
      return recapSettings === null ? null : (
        <RecapScreen settings={recapSettings} onDone={() => setPhase("main")} />
      );

    case "error":
      return (
        <main className={styles.screen}>
          <div className={styles.stack}>
            <p className={styles.eyebrow}>Erreur</p>
            <h1 className={styles.title}>Lecture impossible</h1>
            <p className={styles.note}>{gateError}</p>
            <button
              type="button"
              className={styles.retry}
              onClick={() => setAttempt((current) => current + 1)}
            >
              Réessayer
            </button>
          </div>
        </main>
      );

    default:
      return <HomeArea />;
  }
}
