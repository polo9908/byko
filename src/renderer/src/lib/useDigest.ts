import { useEffect, useState } from "react"
import { NOTIFICATION_BODY_MAX } from "@shared/notifications"
import type { DailyDigest, DigestItem, DigestKind } from "@shared/digest"
import { scopedKey } from "./accountScope"
import { loadAccessibilityPrefs } from "./accessibility"

const REFRESH_MS = 10 * 60_000
const SEEN_KEY = "byko.digest-seen.v1"
const SEEN_MAX = 200
/** Seuls les blocages donnent lieu à une alerte ; le reste se lit dans la vue journée. */
const ALERT_KINDS: DigestKind[] = ["blocker", "blocked", "stale"]

function readSeen(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(scopedKey(SEEN_KEY)) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

/**
 * Un blocage jamais signalé : notification BYKO (main ne l'affiche que si l'app n'est pas au premier plan ; au premier plan,
 * le point est déjà sous les yeux dans la vue journée). Il est retenu dans les deux cas, pour n'être annoncé qu'une fois.
 */
function alertNewBlockers(items: DigestItem[]): void {
  const seen = readSeen()
  const fresh = items.filter((item) => ALERT_KINDS.includes(item.kind) && !seen.includes(item.id))
  if (fresh.length === 0) return
  try {
    window.localStorage.setItem(scopedKey(SEEN_KEY), JSON.stringify([...seen, ...fresh.map((item) => item.id)].slice(-SEEN_MAX)))
  } catch {
    // Stockage indisponible : on n'alerte pas, plutôt que d'alerter à chaque relève.
    return
  }
  const prefs = loadAccessibilityPrefs()
  const more = fresh.length > 1 ? ` (+ ${fresh.length - 1})` : ""
  window.api.notifications
    .show({
      title: "Un blocage à regarder",
      body: `${fresh[0].text.slice(0, NOTIFICATION_BODY_MAX - 12)}${more}`,
      target: "day",
      durationSeconds: prefs.notificationSeconds,
      highContrast: prefs.highContrast,
      reduceMotion: prefs.reduceMotion,
    })
    .catch((err: unknown) => console.warn("Notification impossible :", err))
}

/**
 * Digest de la vue journée (contrat : docs/ipc/digest.md), relu toutes les dix minutes tant que la vue est affichée.
 * `null` tant que la première lecture n'a pas abouti : l'écran garde alors son état par défaut. Une relève en échec
 * conserve le dernier digest connu.
 */
export function useDigest(): DailyDigest | null {
  const [digest, setDigest] = useState<DailyDigest | null>(null)

  useEffect(() => {
    let mounted = true
    const refresh = (): void => {
      window.api.digest
        .get()
        .then((next) => {
          if (!mounted) return
          setDigest(next)
          alertNewBlockers(next.items)
        })
        .catch((err: unknown) => console.warn("Lecture du digest impossible :", err))
    }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  return digest
}
