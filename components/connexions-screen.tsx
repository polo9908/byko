"use client";

import { useEffect, useState } from "react";

import {
  ConnectionBlock,
  type Attempt,
} from "@/components/connection-block";
import { blockingIssues, firstBlockToConfigure, type BlockIssue } from "@/lib/connexions";
import type {
  ConnectionBlockId,
  GetSettingsResponse,
  ProviderId,
  SaveSettingsResponse,
  SettingsState,
  TestConnectionResponse,
} from "@/lib/types/settings";
import styles from "./connexions-screen.module.css";

/**
 * FRONT-2/3/4 — écran Connexions (wizard) et section Connexions de la modale Paramètres
 * (FRONT-12).
 *
 * Orchestrateur des blocs de connexion (ARCHI-6) : lecture de l'état réel
 * (`GET /api/settings`), valeurs saisies, test au blur (FRONT-3), persistance à la
 * validation, accordéon à ouverture unique, bandeau de blocage + « Terminer » (FRONT-4).
 *
 * Deux présentations du même orchestrateur :
 * - `variant="wizard"` (défaut) : page complète avec en-tête et barre d'action ;
 * - `variant="params"` + `embedded` : uniquement la liste des blocs, montée dans la modale
 *   Paramètres (FRONT-11/12) — la modale fournit l'en-tête (titre, version, fermeture).
 *
 * Le comportement d'un bloc (formulaires, test, statuts, liens, « Passer cette étape »)
 * vit dans `components/connection-block.tsx` — aucune duplication entre les contextes.
 */

const UNREADABLE_MESSAGE =
  "Impossible de lire l'état de la configuration. Réessayez dans un instant.";
const TEST_UNREACHABLE_MESSAGE =
  "Le test n'a pas pu joindre le serveur. Réessayez dans un instant.";

interface BlockFormValues {
  jira: { instanceUrl: string; email: string; apiToken: string };
  figma: { apiToken: string };
  ai: { provider: ProviderId | ""; apiToken: string };
}

const EMPTY_VALUES: BlockFormValues = {
  jira: { instanceUrl: "", email: "", apiToken: "" },
  figma: { apiToken: "" },
  ai: { provider: "", apiToken: "" },
};

const BLOCK_META: ReadonlyArray<{
  id: ConnectionBlockId;
  name: string;
  glyph: string;
}> = [
  { id: "jira", name: "Jira", glyph: "J" },
  { id: "figma", name: "Figma", glyph: "F" },
  { id: "ai", name: "Modèle IA", glyph: "IA" },
];

const IDLE_ATTEMPT: Attempt = { status: "idle" };

/** Métadonnées non secrètes du bloc, à re-persister en cas de succès. */
interface ConnectedMeta {
  instanceUrl?: string;
  email?: string;
  provider?: ProviderId;
}

function valuesFromSettings(settings: SettingsState): BlockFormValues {
  return {
    jira: {
      instanceUrl: settings.jira.status === "connected" ? settings.jira.instanceUrl : "",
      email: settings.jira.status === "connected" ? settings.jira.email : "",
      apiToken: "",
    },
    figma: { apiToken: "" },
    ai: {
      provider: settings.ai.status === "connected" ? settings.ai.provider : "",
      apiToken: "",
    },
  };
}

async function fetchSettingsState(): Promise<SettingsState> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("Réponse illisible");
  }
  const parsed = body as GetSettingsResponse;
  if (parsed.status !== "success") {
    throw new Error(parsed.message);
  }
  return parsed.settings;
}

export function ConnexionsScreen({
  variant = "wizard",
  embedded = false,
  onFinish,
}: {
  variant?: "wizard" | "params";
  embedded?: boolean;
  onFinish?: (settings: SettingsState) => void;
} = {}) {
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [expanded, setExpanded] = useState<ConnectionBlockId | null>(null);
  const [values, setValues] = useState<BlockFormValues>(EMPTY_VALUES);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [tests, setTests] = useState<Record<ConnectionBlockId, Attempt>>({
    jira: IDLE_ATTEMPT,
    figma: IDLE_ATTEMPT,
    ai: IDLE_ATTEMPT,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchSettingsState()
      .then((next) => {
        if (!cancelled) {
          setSettings(next);
          setValues(valuesFromSettings(next));
          setExpanded(firstBlockToConfigure(next));
          setErrorMessage(null);
        }
      })
      .catch(() => {
        if (!cancelled) setErrorMessage(UNREADABLE_MESSAGE);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (errorMessage !== null) {
    return (
      <div className={embedded ? styles.embedded : styles.screen}>
        <div className={styles.messageBlock}>
          <p className={styles.errorText}>{errorMessage}</p>
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => setAttempt((current) => current + 1)}
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (settings === null) {
    return <div className={embedded ? styles.embedded : styles.screen} aria-hidden="true" />;
  }

  const toggle = (block: ConnectionBlockId) => {
    setExpanded((current) => (current === block ? null : block));
  };

  const openBlock = (block: ConnectionBlockId) => {
    setExpanded(block);
    requestAnimationFrame(() => {
      document.getElementById(`connection-block-${block}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  // FRONT-4 : blocages qui empêchent « Terminer ». Un échec de test frais (cette session)
  // prime sur le lastError persisté — c'est le message le plus récent qui explique le bloc.
  const issues: BlockIssue[] = blockingIssues(settings).map((issue) => {
    const latest = tests[issue.block];
    return latest.status === "error" && latest.message
      ? { ...issue, message: latest.message }
      : issue;
  });

  const clearTest = (block: ConnectionBlockId) => {
    setTests((current) => ({ ...current, [block]: IDLE_ATTEMPT }));
  };

  const patchValues = <B extends ConnectionBlockId>(
    block: B,
    patch: Partial<BlockFormValues[B]>,
  ) => {
    setValues((current) => ({
      ...current,
      [block]: { ...current[block], ...patch },
    }));
    clearTest(block);
  };

  const skipFigma = async () => {
    setSkipping(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block: "figma", skipped: true }),
      });
      const body = (await response.json()) as SaveSettingsResponse;
      if (body.status !== "success") {
        setErrorMessage(body.message);
        return;
      }
      const next: SettingsState = { ...settings, figma: { status: "skipped" } };
      setSettings(next);
      setValues((current) => ({ ...current, figma: { apiToken: "" } }));
      clearTest("figma");
      setExpanded(firstBlockToConfigure(next));
    } catch {
      setErrorMessage(UNREADABLE_MESSAGE);
    } finally {
      setSkipping(false);
    }
  };

  /**
   * Test au blur d'un bloc : `POST /api/settings/test-connection`, puis — si succès —
   * persistance via `POST /api/settings` avant d'enchaîner sur le bloc suivant.
   */
  const performTest = async (
    block: ConnectionBlockId,
    credentials: unknown,
    apiToken: string,
    meta: ConnectedMeta,
  ) => {
    if (tests[block].status === "testing") return;
    if (block === "ai" && meta.provider === undefined) {
      setTests((t) => ({
        ...t,
        ai: { status: "error", message: "Choisissez d'abord un fournisseur de modèle." },
      }));
      return;
    }
    if (!apiToken.trim()) return;

    setTests((t) => ({ ...t, [block]: { status: "testing" } }));

    try {
      const response = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block, credentials }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          typeof (body as { message?: unknown }).message === "string"
            ? (body as { message: string }).message
            : TEST_UNREACHABLE_MESSAGE;
        setTests((t) => ({ ...t, [block]: { status: "error", message } }));
        return;
      }
      const test = body as TestConnectionResponse;
      if (test.status === "error" || test.block !== block) {
        setTests((t) => ({
          ...t,
          [block]: {
            status: "error",
            message: test.status === "error" ? test.message : TEST_UNREACHABLE_MESSAGE,
          },
        }));
        return;
      }

      const saveResponse = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block, credentials }),
      });
      const saveBody = (await saveResponse.json()) as SaveSettingsResponse;
      if (saveBody.status !== "success") {
        setTests((t) => ({
          ...t,
          [block]: { status: "error", message: saveBody.message },
        }));
        return;
      }

      const nextSettings: SettingsState = {
        ...settings,
        [block]: buildConnectedState(block, test, meta),
      };
      setSettings(nextSettings);
      setTests((t) => ({ ...t, [block]: { status: "success" } }));
      setExpanded(firstBlockToConfigure(nextSettings));
    } catch {
      setTests((t) => ({
        ...t,
        [block]: { status: "error", message: TEST_UNREACHABLE_MESSAGE },
      }));
    }
  };

  const runTestHandlers: Record<
    ConnectionBlockId,
    () => void
  > = {
    jira: () => {
      const { instanceUrl, email, apiToken } = values.jira;
      void performTest("jira", { instanceUrl, email, apiToken }, apiToken, {
        instanceUrl,
        email,
      });
    },
    figma: () => {
      const { apiToken } = values.figma;
      void performTest("figma", { apiToken }, apiToken, {});
    },
    ai: () => {
      const { provider, apiToken } = values.ai;
      void performTest(
        "ai",
        provider === "" ? {} : { provider, apiToken },
        apiToken,
        { provider: provider === "" ? undefined : provider },
      );
    },
  };

  return (
    <main className={embedded ? styles.embedded : styles.screen}>
      <div
        className={
          embedded
            ? styles.columnEmbedded
            : variant === "wizard"
              ? styles.columnWithBar
              : styles.column
        }
      >
        {!embedded && (
          <header className={styles.header}>
            <p className={styles.eyebrow}>
              {variant === "wizard" ? "Configuration" : "Application"}
            </p>
            <h1 className={styles.title}>
              {variant === "wizard" ? "Connexions" : "Paramètres"}
            </h1>
            <p className={styles.intro}>
              {variant === "wizard"
                ? "Connectez vos outils pour analyser vos tickets avant de les démarrer."
                : "Gérez vos connexions Jira, Figma et votre modèle IA."}
            </p>
          </header>
        )}

        <div className={styles.accordion}>
          {BLOCK_META.map(({ id, name, glyph }) => {
            const test = tests[id];
            const open = expanded === id;
            if (id === "jira") {
              return (
                <ConnectionBlock
                  key={id}
                  provider="jira"
                  name={name}
                  glyph={glyph}
                  open={open}
                  state={settings[id]}
                  test={test}
                  values={values.jira}
                  onChange={(patch) => patchValues("jira", patch)}
                  onTokenBlur={runTestHandlers.jira}
                  onToggle={() => toggle("jira")}
                />
              );
            }
            if (id === "figma") {
              return (
                <ConnectionBlock
                  key={id}
                  provider="figma"
                  name={name}
                  glyph={glyph}
                  open={open}
                  state={settings[id]}
                  test={test}
                  apiToken={values.figma.apiToken}
                  skipping={skipping}
                  onTokenChange={(apiToken) => patchValues("figma", { apiToken })}
                  onTokenBlur={runTestHandlers.figma}
                  onSkip={() => void skipFigma()}
                  onToggle={() => toggle("figma")}
                />
              );
            }
            return (
              <ConnectionBlock
                key={id}
                provider="ai"
                name={name}
                glyph={glyph}
                open={open}
                state={settings[id]}
                test={test}
                providerValue={values.ai.provider}
                apiToken={values.ai.apiToken}
                onProviderChange={(provider) => patchValues("ai", { provider })}
                onTokenChange={(apiToken) => patchValues("ai", { apiToken })}
                onTokenBlur={runTestHandlers.ai}
                onToggle={() => toggle("ai")}
              />
            );
          })}
        </div>

        {!embedded && variant === "wizard" && (
          <div className={issues.length > 0 ? styles.actionBarBlocked : styles.actionBar}>
            <div className={styles.actionInner}>
              {issues.length > 0 ? (
                <div className={styles.blockers}>
                  {issues.map((issue) => (
                    <button
                      key={issue.block}
                      type="button"
                      className={styles.blockerRow}
                      onClick={() => openBlock(issue.block)}
                    >
                      <span className={styles.blockerBadge}>
                        {issue.block === "jira" ? "Jira" : "Modèle IA"}
                      </span>
                      <span className={styles.blockerText}>{issue.message}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.readyNote}>Tout est prêt pour l&apos;étape suivante.</p>
              )}
              <button
                type="button"
                className={styles.primaryButton}
                disabled={issues.length > 0}
                onClick={() => onFinish?.(settings)}
              >
                Terminer
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * État persisté du bloc après un test réussi. Le jeton n'y figure jamais (ARCHI-3/BACK-4) ;
 * seules les métadonnées non secrètes (URL, e-mail, provider, nom de compte) sont stockées,
 * telles que confirmées par la réponse du test.
 */
function buildConnectedState(
  block: ConnectionBlockId,
  test: TestConnectionResponse,
  meta: ConnectedMeta,
): SettingsState[ConnectionBlockId] {
  const accountName =
    test.block === "jira" && test.status === "success"
      ? test.account.accountName
      : test.block === "figma" && test.status === "success"
        ? test.account?.accountName
        : undefined;

  if (block === "jira") {
    return {
      status: "connected",
      instanceUrl: meta.instanceUrl ?? "",
      email: meta.email ?? "",
      account: { accountName: accountName ?? meta.instanceUrl ?? "" },
    };
  }
  if (block === "figma") {
    return accountName
      ? { status: "connected", account: { accountName } }
      : { status: "connected" };
  }
  if (block === "ai") {
    return { status: "connected", provider: meta.provider as ProviderId };
  }
  return { status: "not_connected" };
}
