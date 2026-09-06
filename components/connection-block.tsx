"use client";

import type { ReactNode } from "react";

import { PROVIDER_LINKS, getCreateTokenLabel } from "@/lib/providers-links";
import type {
  AiSettingsState,
  FigmaSettingsState,
  JiraSettingsState,
  ProviderId,
} from "@/lib/types/settings";
import styles from "./connection-block.module.css";

/**
 * ARCHI-6 — bloc de connexion partagé (`components/ConnectionBlock.tsx`).
 *
 * Un bloc de connexion (Jira, Figma ou Modèle IA), paramétré par `provider` :
 * ligne résumé (icône + nom + statut + chevron) et, ouvert, le formulaire propre au
 * provider (champs, test au blur, liens de création de jeton, états visuels).
 *
 * Le composant est PUR de contexte : il ne connaît ni le wizard, ni la modale Paramètres,
 * ni la persistance — le parent (écran Connexions ou modale) lui passe l'état réel
 * (`state`), les valeurs saisies et les gestionnaires. Un même comportement de bloc
 * (test, statuts, liens) sert donc les deux contextes sans duplication (critère
 * d'acceptation d'ARCHI-6).
 *
 * Liens de création de jeton : Jira → compte Atlassian (Jira Cloud) ; IA → dynamique par
 * provider (`lib/providers-links.ts`, ARCHI-2b). Figma n'en porte pas (le bloc Figma ne
 * propose que le jeton et « Passer cette étape ») — jamais le mot « optionnel ».
 */

export type AttemptStatus = "idle" | "testing" | "success" | "error";

export interface Attempt {
  status: AttemptStatus;
  message?: string;
}

const JIRA_TOKEN_CREATE_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";
const JIRA_TOKEN_CREATE_LABEL = "Créer un jeton API Jira";

export type ConnectionBlockProps =
  | {
      provider: "jira";
      name: string;
      glyph: string;
      open: boolean;
      state: JiraSettingsState;
      test: Attempt;
      values: { instanceUrl: string; email: string; apiToken: string };
      onChange: (patch: Partial<{ instanceUrl: string; email: string; apiToken: string }>) => void;
      onTokenBlur: () => void;
      onToggle: () => void;
    }
  | {
      provider: "figma";
      name: string;
      glyph: string;
      open: boolean;
      state: FigmaSettingsState;
      test: Attempt;
      apiToken: string;
      skipping: boolean;
      onTokenChange: (token: string) => void;
      onTokenBlur: () => void;
      onSkip: () => void;
      onToggle: () => void;
    }
  | {
      provider: "ai";
      name: string;
      glyph: string;
      open: boolean;
      state: AiSettingsState;
      test: Attempt;
      providerValue: ProviderId | "";
      apiToken: string;
      onProviderChange: (provider: ProviderId) => void;
      onTokenChange: (token: string) => void;
      onTokenBlur: () => void;
      onToggle: () => void;
    };

export function ConnectionBlock(props: ConnectionBlockProps) {
  const { provider, name, glyph, open, onToggle } = props;
  const state = props.state;
  const test = props.test;
  const done = state.status === "connected" || state.status === "skipped";

  return (
    <section
      id={`connection-block-${provider}`}
      className={done && !open ? styles.blockDone : styles.block}
    >
      <button
        type="button"
        className={styles.blockHeader}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={styles.glyph} aria-hidden="true">
          {glyph}
        </span>
        <span className={styles.blockTitle}>{name}</span>
        <StatusSummary state={state} />
        <span className={open ? styles.chevronOpen : styles.chevron} aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className={styles.panel}>
          {provider === "jira" && (
            <JiraFields
              values={props.values}
              tokenStatus={test.status}
              onChange={props.onChange}
              onTokenBlur={props.onTokenBlur}
            />
          )}
          {provider === "figma" && (
            <FigmaFields
              apiToken={props.apiToken}
              skipped={state.status === "skipped"}
              skipping={props.skipping}
              testing={test.status === "testing"}
              tokenStatus={test.status}
              onTokenChange={props.onTokenChange}
              onTokenBlur={props.onTokenBlur}
              onSkip={props.onSkip}
            />
          )}
          {provider === "ai" && (
            <AiFields
              provider={props.providerValue}
              apiToken={props.apiToken}
              tokenStatus={test.status}
              onProviderChange={props.onProviderChange}
              onTokenChange={props.onTokenChange}
              onTokenBlur={props.onTokenBlur}
            />
          )}
          <AttemptFeedback attempt={test} />
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Résumé + statut                                                             */
/* -------------------------------------------------------------------------- */

function StatusSummary({
  state,
}: {
  state: JiraSettingsState | FigmaSettingsState | AiSettingsState;
}) {
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

/* -------------------------------------------------------------------------- */
/* Champ + états visuels                                                       */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Formulaires par provider                                                    */
/* -------------------------------------------------------------------------- */

function JiraFields({
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

function FigmaFields({
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

function AiFields({
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
