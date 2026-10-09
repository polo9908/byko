/** Notifications BYKO (contrat : docs/ipc/notifications.md). */

/** Durées d'affichage proposées dans Réglages > Accessibilité, en secondes (5 s minimum). */
export const NOTIFICATION_DURATIONS = [5, 10, 30, 60, 120] as const
export type NotificationDuration = (typeof NOTIFICATION_DURATIONS)[number]
export const NOTIFICATION_DEFAULT_DURATION: NotificationDuration = 10

export const NOTIFICATION_TITLE_MAX = 80
export const NOTIFICATION_BODY_MAX = 240

/** Page de BYKO où mène un clic sur la notification (liste blanche : main n'envoie jamais autre chose au renderer). */
export const NOTIFICATION_TARGETS = ["day", "pointdequipe", "journal", "settings", "settings-accessibility"] as const
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number]

export function isNotificationTarget(value: unknown): value is NotificationTarget {
  return NOTIFICATION_TARGETS.some((target) => target === value)
}

export interface NotificationPayload {
  title: string
  body: string
  /** Page ouverte au clic ; « day » (vue journée) par défaut. */
  target?: NotificationTarget
  durationSeconds: NotificationDuration
  /** Reprend les préférences visuelles du renderer (le toast est une fenêtre à part). */
  highContrast?: boolean
  reduceMotion?: boolean
}

export interface NotificationResult {
  /** Faux si l'app était au premier plan : la notification n'a alors pas lieu d'être. */
  shown: boolean
}

export function formatDuration(seconds: number): string {
  return seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`
}
