/** Réglages de confidentialité (contrat : docs/ipc/assistant-context-privacy.md). */
export interface PrivacySettings {
  /** Journal d'hier + décisions/tâches récentes de point d'équipe inclus dans le prompt de `assistant:ask`. */
  shareRecentActivityWithAi: boolean
  /** Interrupteur général : désactivé, aucune complétion n'est demandée au fournisseur d'IA (la vérification d'une clé à la connexion reste permise). */
  aiEnabled: boolean
}

export const PRIVACY_DEFAULTS: PrivacySettings = { shareRecentActivityWithAi: true, aiEnabled: true }
