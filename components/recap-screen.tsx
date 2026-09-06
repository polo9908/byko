"use client";

import { useState } from "react";

import { PROVIDER_LINKS } from "@/lib/providers-links";
import type {
  SaveSettingsResponse,
  SettingsState,
} from "@/lib/types/settings";
import styles from "./recap-screen.module.css";

/**
 * FRONT-5 — écran Récap (artboard « 3 — Récap »).
 *
 * Liste les 3 connexions avec leur statut final — jamais de valeur figée : tout est lu de
 * l'état réel (`settings`) validé à l'écran précédent (nom d'instance Jira, provider IA,
 * statut Figma). Le bouton « Accéder à l'outil » marque la configuration initiale comme
 * terminée (`POST /api/settings`, variante onboarding de l'avenant BACK-4) : seul ce
 * passage fait passer `onboardingCompleted` à `true`, et l'Intro ne se réaffiche plus.
 */

const SAVE_ERROR_MESSAGE =
  "La configuration n'a pas pu être marquée comme terminée. Réessayez.";

function Row({
  glyph,
  name,
  status,
  detail,
}: {
  glyph: string;
  name: string;
  status: "connected" | "skipped" | "todo";
  detail?: string;
}) {
  return (
    <li className={styles.row}>
      <span className={styles.glyph} aria-hidden="true">
        {glyph}
      </span>
      <span className={styles.rowName}>{name}</span>
      <span className={styles.rowDetail}>{detail}</span>
      <span
        className={
          status === "connected"
            ? styles.chipConnected
            : status === "skipped"
              ? styles.chipNeutral
              : styles.chipTodo
        }
      >
        {status === "connected" ? "Connecté" : status === "skipped" ? "Passée" : "Non connectée"}
      </span>
    </li>
  );
}

export function RecapScreen({
  settings,
  onDone,
}: {
  settings: SettingsState;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const finishOnboarding = async () => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block: "onboarding", onboardingCompleted: true }),
      });
      const body = (await response.json()) as SaveSettingsResponse;
      if (body.status !== "success") {
        setErrorMessage(body.message);
        setSaving(false);
        return;
      }
      onDone();
    } catch {
      setErrorMessage(SAVE_ERROR_MESSAGE);
      setSaving(false);
    }
  };

  const jiraDetail =
    settings.jira.status === "connected" ? settings.jira.account.accountName : undefined;
  const figmaDetail =
    settings.figma.status === "connected" && settings.figma.account?.accountName
      ? settings.figma.account.accountName
      : undefined;
  const aiDetail =
    settings.ai.status === "connected"
      ? PROVIDER_LINKS[settings.ai.provider].label
      : undefined;

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Configuration</p>
          <h1 className={styles.title}>Tout est prêt</h1>
          <p className={styles.intro}>
            Voici le récapitulatif de vos connexions avant d&apos;entrer dans l&apos;outil.
          </p>
        </header>

        <ul className={styles.list}>
          <Row
            glyph="J"
            name="Jira"
            status={settings.jira.status === "connected" ? "connected" : "todo"}
            detail={jiraDetail}
          />
          <Row
            glyph="F"
            name="Figma"
            status={
              settings.figma.status === "connected"
                ? "connected"
                : settings.figma.status === "skipped"
                  ? "skipped"
                  : "todo"
            }
            detail={figmaDetail}
          />
          <Row
            glyph="IA"
            name="Modèle IA"
            status={settings.ai.status === "connected" ? "connected" : "todo"}
            detail={aiDetail}
          />
        </ul>

        {errorMessage !== null && (
          <p className={styles.errorText} role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="button"
          className={styles.primaryButton}
          disabled={saving}
          onClick={() => void finishOnboarding()}
        >
          {saving ? "Ouverture…" : "Accéder à l'outil"}
        </button>
      </div>
    </main>
  );
}
