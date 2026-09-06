"use client";

import { useEffect, useState, type ReactNode } from "react";

import { blockingIssues, firstBlockToConfigure, type BlockIssue } from "@/lib/connexions";
import { PROVIDER_LINKS, getCreateTokenLabel } from "@/lib/providers-links";
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
 * FRONT-2/FRONT-3 — écran Connexions : accordéon des 3 blocs + test de connexion au blur.
 *
 * FRONT-2 (structure) : un seul bloc développé à la fois ; les blocs déjà traités
 * (`connected`, ou `skipped` pour Figma) démarrent repliés, le premier non traité s'ouvre ;
 * champs pré-remplis depuis `GET /api/settings` (jamais le jeton, non stocké) ; liens de
 * création de jeton (Jira : compte Atlassian ; IA : dynamique par provider, ARCHI-2b) ;
 * Figma porte « Passer cette étape » — jamais le mot « optionnel ».
 *
 * FRONT-3 (test en direct) : dès que le champ jeton perd le focus (`onBlur`), la connexion
 * est testée via `POST /api/settings/test-connection` (BACK-1/2/3) — aucun bouton
 * « Tester ». Trois états visuels distincts : en cours (spinner), succès (vert, l'écran
 * enchaîne sur le bloc suivant après persistance via `POST /api/settings`), erreur (rouge,
 * croix + message exact renvoyé par le backend — jamais un texte générique).
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

/**
 * Page officielle de création d'un jeton API pour Jira Cloud (id.atlassian.com).
 * Indépendante de l'instance : le jeton est créé au niveau du compte Atlassian, pas de
 * l'instance. (Les instances Data Center auto-hébergées utilisent un autre mécanisme —
 * PAT — hors périmètre V1 du wizard.)
 */
const JIRA_TOKEN_CREATE_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";
const JIRA_TOKEN_CREATE_LABEL = "Créer un jeton API Jira";

type AttemptStatus = "idle" | "testing" | "success" | "error";

interface Attempt {
  status: AttemptStatus;
  message?: string;
}

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
  onFinish,
  onBack,
}: {
  variant?: "wizard" | "params";
  onFinish?: (settings: SettingsState) => void;
  onBack?: () => void;
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
      <main className={styles.screen}>
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
      </main>
    );
  }

  if (settings === null) {
    return <main className={styles.screen} aria-hidden="true" />;
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

  const runJiraTest = () => {
    const { instanceUrl, email, apiToken } = values.jira;
    void performTest(
      "jira",
      { instanceUrl, email, apiToken },
      apiToken,
      { instanceUrl, email },
    );
  };

  const runFigmaTest = () => {
    const { apiToken } = values.figma;
    void performTest("figma", { apiToken }, apiToken, {});
  };

  const runAiTest = () => {
    const { provider, apiToken } = values.ai;
    void performTest(
      "ai",
      provider === "" ? {} : { provider, apiToken },
      apiToken,
      { provider: provider === "" ? undefined : provider },
    );
  };

  return (
    <main className={styles.screen}>
      <div className={variant === "wizard" ? styles.columnWithBar : styles.column}>
        <header className={styles.header}>
          {variant === "params" && onBack !== undefined && (
            <button type="button" className={styles.backLink} onClick={onBack}>
              ← Retour
            </button>
          )}
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

        <div className={styles.accordion}>
          {BLOCK_META.map(({ id, name, glyph }) => {
            const state = settings[id];
            const isOpen = expanded === id;
            const done = state.status === "connected" || state.status === "skipped";
            const test = tests[id];
            return (
              <section
                key={id}
                id={`connection-block-${id}`}
                className={done && !isOpen ? styles.blockDone : styles.block}
              >
                <button
                  type="button"
                  className={styles.blockHeader}
                  onClick={() => toggle(id)}
                  aria-expanded={isOpen}
                >
                  <span className={styles.glyph} aria-hidden="true">
                    {glyph}
                  </span>
                  <span className={styles.blockTitle}>{name}</span>
                  <StatusSummary state={state} />
                  <span
                    className={isOpen ? styles.chevronOpen : styles.chevron}
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
                {isOpen && (
                  <div className={styles.panel}>
                    {id === "jira" && (
                      <>
                        <JiraForm
                          values={values.jira}
                          tokenStatus={test.status}
                          onChange={(patch) => patchValues("jira", patch)}
                          onTokenBlur={runJiraTest}
                        />
                        <AttemptFeedback attempt={test} />
                      </>
                    )}
                    {id === "figma" && (
                      <>
                        <FigmaForm
                          apiToken={values.figma.apiToken}
                          skipped={state.status === "skipped"}
                          skipping={skipping}
                          testing={test.status === "testing"}
                          tokenStatus={test.status}
                          onTokenChange={(apiToken) => patchValues("figma", { apiToken })}
                          onTokenBlur={runFigmaTest}
                          onSkip={() => void skipFigma()}
                        />
                        <AttemptFeedback attempt={test} />
                      </>
                    )}
                    {id === "ai" && (
                      <>
                        <AiForm
                          provider={values.ai.provider}
                          apiToken={values.ai.apiToken}
                          tokenStatus={test.status}
                          onProviderChange={(provider) => patchValues("ai", { provider })}
                          onTokenChange={(apiToken) => patchValues("ai", { apiToken })}
                          onTokenBlur={runAiTest}
                        />
                        <AttemptFeedback attempt={test} />
                      </>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {variant === "wizard" && (
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

function StatusSummary({ state }: { state: SettingsState[ConnectionBlockId] }) {
  if (state.status === "connected") {
    const detail =
      "account" in state && state.account?.accountName
        ? state.account.accountName
        : "provider" in state
          ? PROVIDER_LINKS[state.provider].label
          : "instanceUrl" in state
            ? state.instanceUrl.replace(/^https?:\/\//, "")
            : undefined;
    return (
      <>
        <span className={styles.chipConnected}>Connecté</span>
        {detail !== undefined && <span className={styles.blockDetail}>{detail}</span>}
      </>
    );
  }
  if (state.status === "skipped") {
    return (
      <>
        <span className={styles.chipNeutral}>Passée</span>
        <span className={styles.blockDetail}>Configurable dans Paramètres</span>
      </>
    );
  }
  return <span className={styles.chipTodo}>À configurer</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function tokenInputClass(status: AttemptStatus): string {
  if (status === "error") return styles.inputError;
  if (status === "testing") return styles.inputBusy;
  return styles.input;
}

function AttemptFeedback({ attempt }: { attempt: Attempt }) {
  if (attempt.status === "idle") return null;
  if (attempt.status === "testing") {
    return (
      <p className={styles.attemptRow} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.attemptText}>Test de la connexion en cours…</span>
      </p>
    );
  }
  if (attempt.status === "error") {
    return (
      <p className={styles.attemptRow} role="alert">
        <span className={styles.attemptIconError} aria-hidden="true">
          ✕
        </span>
        <span className={styles.attemptError}>{attempt.message}</span>
      </p>
    );
  }
  return (
    <p className={styles.attemptRow} role="status">
      <span className={styles.attemptIconOk} aria-hidden="true">
        ✓
      </span>
      <span className={styles.attemptOk}>Connexion validée.</span>
    </p>
  );
}

function JiraForm({
  values,
  tokenStatus,
  onChange,
  onTokenBlur,
}: {
  values: { instanceUrl: string; email: string; apiToken: string };
  tokenStatus: AttemptStatus;
  onChange: (patch: Partial<{ instanceUrl: string; email: string; apiToken: string }>) => void;
  onTokenBlur: () => void;
}) {
  return (
    <div className={styles.form}>
      <Field label="URL de l'instance">
        <input
          type="url"
          className={styles.input}
          value={values.instanceUrl}
          placeholder="https://votre-domaine.atlassian.net"
          onChange={(event) => onChange({ instanceUrl: event.target.value })}
        />
      </Field>
      <Field label="Adresse e-mail">
        <input
          type="email"
          className={styles.input}
          value={values.email}
          placeholder="vous@entreprise.fr"
          onChange={(event) => onChange({ email: event.target.value })}
        />
      </Field>
      <Field label="Jeton API">
        <input
          type="password"
          className={tokenInputClass(tokenStatus)}
          value={values.apiToken}
          onChange={(event) => onChange({ apiToken: event.target.value })}
          onBlur={onTokenBlur}
        />
      </Field>
      <a
        className={styles.tokenLink}
        href={JIRA_TOKEN_CREATE_URL}
        target="_blank"
        rel="noreferrer"
      >
        {JIRA_TOKEN_CREATE_LABEL}
      </a>
    </div>
  );
}

function FigmaForm({
  apiToken,
  skipped,
  skipping,
  testing,
  tokenStatus,
  onTokenChange,
  onTokenBlur,
  onSkip,
}: {
  apiToken: string;
  skipped: boolean;
  skipping: boolean;
  testing: boolean;
  tokenStatus: AttemptStatus;
  onTokenChange: (token: string) => void;
  onTokenBlur: () => void;
  onSkip: () => void;
}) {
  return (
    <div className={styles.form}>
      <Field label="Jeton">
        <input
          type="password"
          className={tokenInputClass(tokenStatus)}
          value={apiToken}
          onChange={(event) => onTokenChange(event.target.value)}
          onBlur={onTokenBlur}
        />
      </Field>
      {!skipped && (
        <button
          type="button"
          className={styles.skipLink}
          onClick={onSkip}
          disabled={skipping || testing}
        >
          {skipping ? "Passage…" : "Passer cette étape, configurable plus tard dans Paramètres"}
        </button>
      )}
    </div>
  );
}

function AiForm({
  provider,
  apiToken,
  tokenStatus,
  onProviderChange,
  onTokenChange,
  onTokenBlur,
}: {
  provider: ProviderId | "";
  apiToken: string;
  tokenStatus: AttemptStatus;
  onProviderChange: (provider: ProviderId) => void;
  onTokenChange: (token: string) => void;
  onTokenBlur: () => void;
}) {
  return (
    <div className={styles.form}>
      <Field label="Fournisseur du modèle">
        <select
          className={styles.input}
          value={provider}
          onChange={(event) => onProviderChange(event.target.value as ProviderId)}
        >
          <option value="" disabled>
            Choisir un fournisseur
          </option>
          {(Object.keys(PROVIDER_LINKS) as ProviderId[]).map((id) => (
            <option key={id} value={id}>
              {PROVIDER_LINKS[id].label}
            </option>
          ))}
        </select>
      </Field>
      {provider !== "" && (
        <>
          <Field label="Jeton">
            <input
              type="password"
              className={tokenInputClass(tokenStatus)}
              value={apiToken}
              onChange={(event) => onTokenChange(event.target.value)}
              onBlur={onTokenBlur}
            />
          </Field>
          <a
            className={styles.tokenLink}
            href={PROVIDER_LINKS[provider].tokenUrl}
            target="_blank"
            rel="noreferrer"
          >
            {getCreateTokenLabel(provider)}
          </a>
        </>
      )}
    </div>
  );
}
