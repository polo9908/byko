"use client";

import type { ComponentRecommendation, ComponentStatus } from "@/lib/types/analysis";
import {
  COMPONENTS_EMPTY_MESSAGE,
  COMPONENTS_FIGMA_MESSAGE,
  COMPONENTS_NO_SCOPE_MESSAGE,
  COMPONENT_STATUS_LABELS,
  COMPONENT_STATUS_THEMES,
  componentInitials,
  componentsSectionKind,
} from "@/lib/workspace";
import styles from "./components-section.module.css";

/**
 * FRONT-10 — section composants de l'écran de résultat.
 *
 * Montée par `ResultScreen` quand l'événement `components` (BACK-8) arrive dans le flux,
 * après la traduction. Trois états d'affichage, décidés par le helper pur
 * `componentsSectionKind` (`lib/workspace.ts`), JAMAIS confondus visuellement :
 * - Figma non connecté → message d'incitation + bouton « Ouvrir les Paramètres »
 *   (`onOpenSettings`, canal fourni par HomeArea) à la place des cartes ;
 * - périmètre de comparaison « none » (mode manuel, champ « Epic / composant » vide) →
 *   message dédié plutôt qu'une grille vide silencieuse ;
 * - zéro composant proposé → état vide honnête.
 *
 * Les cartes : aperçu sans image (le contrat BACK-8 ne porte aucune miniature Figma — la
 * zone d'aperçu met en avant la première lettre du nom, sur la teinte de l'état), nom,
 * badge d'état 3 couleurs, lien Figma POUR `reusable`/`to_verify` uniquement — pour
 * `to_create`, `figmaUrl` est absent par construction (conséquence attendue de l'état,
 * pas une panne : rien à lier). Les URLs Figma sont servies par le backend (MCP-3) et
 * passées telles quelles dans `href` : jamais réécrites, jamais de recherche côté front.
 */

export function ComponentsSection({
  figmaConnected,
  components,
  scopeNone,
  onOpenSettings,
}: {
  figmaConnected: boolean;
  components: readonly ComponentRecommendation[];
  scopeNone: boolean;
  onOpenSettings?: () => void;
}) {
  const kind = componentsSectionKind({
    figmaConnected,
    componentsCount: components.length,
    scopeNone,
  });

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Composants</h2>

      {kind.kind === "cards" ? (
        <ul className={styles.grid}>
          {components.map((component, index) => (
            <ComponentCard
              key={`${component.name}-${index}`}
              component={component}
            />
          ))}
        </ul>
      ) : kind.kind === "figma_disconnected" ? (
        <div className={styles.figmaNotice} role="status">
          <p className={styles.figmaText}>{COMPONENTS_FIGMA_MESSAGE}</p>
          {onOpenSettings !== undefined && (
            <button
              type="button"
              className={styles.settingsLink}
              onClick={onOpenSettings}
            >
              Ouvrir les Paramètres
            </button>
          )}
        </div>
      ) : kind.kind === "scope_none" ? (
        <p className={styles.scopeNoneNotice} role="status">
          {COMPONENTS_NO_SCOPE_MESSAGE}
        </p>
      ) : (
        <p className={styles.emptyNotice} role="status">
          {COMPONENTS_EMPTY_MESSAGE}
        </p>
      )}
    </section>
  );
}

function ComponentCard({ component }: { component: ComponentRecommendation }) {
  const theme = COMPONENT_STATUS_THEMES[component.status];
  return (
    <li className={styles.card}>
      <div className={styles.preview} style={{ background: theme.background }}>
        <span
          className={styles.previewMark}
          style={{ color: theme.color }}
          aria-hidden="true"
        >
          {componentInitials(component.name)}
        </span>
      </div>
      <div className={styles.cardBody}>
        <h3 className={styles.cardName} title={component.name}>
          {component.name}
        </h3>
        <div className={styles.cardMeta}>
          <StatusBadge status={component.status} />
          {component.figmaUrl !== undefined && (
            <a
              className={styles.figmaLink}
              href={component.figmaUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ouvrir dans Figma
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: ComponentStatus }) {
  const theme = COMPONENT_STATUS_THEMES[status];
  return (
    <span
      className={styles.badge}
      style={{ color: theme.color, background: theme.background }}
    >
      {COMPONENT_STATUS_LABELS[status]}
    </span>
  );
}
