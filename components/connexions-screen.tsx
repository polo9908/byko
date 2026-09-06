"use client";

import { useEffect, useState, type ReactNode } from "react";

import { firstBlockToConfigure } from "@/lib/connexions";
import { PROVIDER_LINKS, getCreateTokenLabel } from "@/lib/providers-links";
import type {
  ConnectionBlockId,
  GetSettingsResponse,
  ProviderId,
  SaveSettingsResponse,
  SettingsState,
} from "@/lib/types/settings";
import styles from "./connexions-screen.module.css";

/**
 * FRONT-2 — écran Connexions : structure accordéon + 3 blocs (Jira, Figma, Modèle IA).
 *
 * Périmètre de ce ticket (docs/tickets/phase-1-configuration.md) : un seul bloc développé à
 * la fois, les autres repliés en ligne compacte (icône + nom + statut + chevron) ; les blocs
 * déjà traités (`connected`, ou `skipped` pour Figma) démarrent repliés et le premier bloc
 * non traité s'ouvre ; champs pré-remplis depuis l'état réel (`GET /api/settings`) quand la
 * connexion existe (URL d'instance, e-mail, provider — jamais le jeton, non stocké) ; lien
 * dynamique « Créer jeton [Nom] » sous le champ jeton du bloc IA (libellé ET URL depuis
 * `lib/providers-links.ts`, ARCHI-2b) ; Figma porte « Passer cette étape, configurable plus
 * tard dans Paramètres » — jamais le mot « optionnel ».
 *
 * Le test de connexion au blur et la sauvegarde au fil de l'eau arrivent avec FRONT-3 ; le
 * bandeau de blocage et « Terminer » avec FRONT-4. Ici, l'état d'un bloc ne change que par
 * « Passer cette étape » (Figma), qui appelle l'écriture `skipped` du contrat BACK-4.
 */

const UNREADABLE_MESSAGE =
  "Impossible de lire l'état de la configuration. Réessayez dans un instant.";

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

export function ConnexionsScreen() {
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [expanded, setExpanded] = useState<ConnectionBlockId | null>(null);
  const [values, setValues] = useState<BlockFormValues>(EMPTY_VALUES);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

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
      setExpanded(firstBlockToConfigure(next));
    } catch {
      setErrorMessage(UNREADABLE_MESSAGE);
    } finally {
      setSkipping(false);
    }
  };

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Configuration</p>
          <h1 className={styles.title}>Connexions</h1>
          <p className={styles.intro}>
            Connectez vos outils pour analyser vos tickets avant de les démarrer.
          </p>
        </header>

        <div className={styles.accordion}>
          {BLOCK_META.map(({ id, name, glyph }) => {
            const state = settings[id];
            const isOpen = expanded === id;
            const done = state.status === "connected" || state.status === "skipped";
            return (
              <section key={id} className={done && !isOpen ? styles.blockDone : styles.block}>
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
                      <JiraForm
                        values={values.jira}
                        onChange={(jira) => setValues((current) => ({ ...current, jira }))}
                      />
                    )}
                    {id === "figma" && (
                      <FigmaForm
                        apiToken={values.figma.apiToken}
                        skipped={state.status === "skipped"}
                        skipping={skipping}
                        onTokenChange={(apiToken) =>
                          setValues((current) => ({ ...current, figma: { apiToken } }))
                        }
                        onSkip={() => void skipFigma()}
                      />
                    )}
                    {id === "ai" && (
                      <AiForm
                        provider={values.ai.provider}
                        apiToken={values.ai.apiToken}
                        onProviderChange={(provider) =>
                          setValues((current) => ({
                            ...current,
                            ai: { ...current.ai, provider },
                          }))
                        }
                        onTokenChange={(apiToken) =>
                          setValues((current) => ({
                            ...current,
                            ai: { ...current.ai, apiToken },
                          }))
                        }
                      />
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
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

function JiraForm({
  values,
  onChange,
}: {
  values: { instanceUrl: string; email: string; apiToken: string };
  onChange: (values: { instanceUrl: string; email: string; apiToken: string }) => void;
}) {
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    onChange({ ...values, [key]: value });
  return (
    <div className={styles.form}>
      <Field label="URL de l'instance">
        <input
          type="url"
          className={styles.input}
          value={values.instanceUrl}
          placeholder="https://votre-domaine.atlassian.net"
          onChange={(event) => set("instanceUrl", event.target.value)}
        />
      </Field>
      <Field label="Adresse e-mail">
        <input
          type="email"
          className={styles.input}
          value={values.email}
          placeholder="vous@entreprise.fr"
          onChange={(event) => set("email", event.target.value)}
        />
      </Field>
      <Field label="Jeton API">
        <input
          type="password"
          className={styles.input}
          value={values.apiToken}
          onChange={(event) => set("apiToken", event.target.value)}
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
  onTokenChange,
  onSkip,
}: {
  apiToken: string;
  skipped: boolean;
  skipping: boolean;
  onTokenChange: (token: string) => void;
  onSkip: () => void;
}) {
  return (
    <div className={styles.form}>
      <Field label="Jeton">
        <input
          type="password"
          className={styles.input}
          value={apiToken}
          onChange={(event) => onTokenChange(event.target.value)}
        />
      </Field>
      {!skipped && (
        <button
          type="button"
          className={styles.skipLink}
          onClick={onSkip}
          disabled={skipping}
        >
          {skipping
            ? "Passage…"
            : "Passer cette étape, configurable plus tard dans Paramètres"}
        </button>
      )}
    </div>
  );
}

function AiForm({
  provider,
  apiToken,
  onProviderChange,
  onTokenChange,
}: {
  provider: ProviderId | "";
  apiToken: string;
  onProviderChange: (provider: ProviderId) => void;
  onTokenChange: (token: string) => void;
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
              className={styles.input}
              value={apiToken}
              onChange={(event) => onTokenChange(event.target.value)}
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
