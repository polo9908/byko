import { useSyncExternalStore } from "react"
import { getSoundSnapshot, subscribeSound, toggleMute } from "./sound"
import type { SoundSnapshot } from "./sound"

/**
 * État du son pour l'interface (sourdine + contexte audio déverrouillé).
 * Seule la vue journée en a besoin — les autres écrans se contentent d'appeler
 * `playSfx` / `playSetupSound` au moment voulu.
 */
export function useSound(): SoundSnapshot & { toggleMute: () => void } {
  const snapshot = useSyncExternalStore(subscribeSound, getSoundSnapshot)
  return { ...snapshot, toggleMute }
}
