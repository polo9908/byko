import { useLayoutEffect, useRef } from "react"
import type { RefObject } from "react"
import { prefersReducedMotion, spring } from "./motion"
import type { Spring } from "./motion"

interface FlipEntry {
  el: HTMLElement
  rest: number
  offset: number
  spring: Spring | null
}

/**
 * Mise en page physique (FLIP) : après chaque rendu, tout élément `[data-flip-key]` de `root`
 * qui a changé de place repart de son ancienne position et glisse jusqu'à la nouvelle en
 * ressort, au lieu de sauter (ajout d'une ligne, retour à la ligne pendant la frappe, retrait…).
 *
 * Chaque élément ne compense que son propre déplacement, mesuré par rapport à son ancêtre
 * `[data-flip-key]` le plus proche : une section qui glisse emporte ses lignes sans les décaler
 * deux fois. Le décalage passe par `top` (position relative) pour ne pas entrer en conflit avec
 * `translate`/`scale`, réservés aux entrées et aux pressions.
 */
export function useFlip(rootRef: RefObject<HTMLElement | null>): void {
  const entries = useRef(new Map<string, FlipEntry>())
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const seen = new Set<string>()
    root.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((el) => {
      const key = el.dataset.flipKey
      if (!key) return
      seen.add(key)
      const parent = el.parentElement?.closest<HTMLElement>("[data-flip-key]")
      const ref = parent && root.contains(parent) ? parent : root
      let entry = entries.current.get(key)
      if (entry && entry.el !== el) entry = undefined
      const offset = entry?.offset ?? 0
      const rest = el.getBoundingClientRect().top - ref.getBoundingClientRect().top - offset
      if (!entry) {
        entries.current.set(key, { el, rest, offset: 0, spring: null })
        return
      }
      const delta = entry.rest - rest
      entry.rest = rest
      if (Math.abs(delta) < 0.5 || prefersReducedMotion()) return
      const current = entry
      if (getComputedStyle(el).position === "static") el.style.position = "relative"
      if (!current.spring) {
        current.spring = spring(0, 0, { stiffness: 320, damping: 26, precision: 50 }, (y) => {
          current.offset = y
          current.el.style.top = y === 0 ? "" : `${y.toFixed(2)}px`
        })
      }
      current.spring.set(current.offset + delta)
      current.spring.retarget(0)
    })
    for (const [key, entry] of entries.current) {
      if (!seen.has(key)) {
        entry.spring?.stop()
        entries.current.delete(key)
      }
    }
  })
}

/**
 * Interrupteur physique : le pouce est un ressort (léger dépassement), il s'allonge sous la
 * vitesse comme une goutte (le bord arrière traîne), et la couleur de la piste suit sa position.
 */
export function useSwitchSpring(
  switchRef: RefObject<HTMLElement | null>,
  checked: boolean,
  /** Faux tant que l'interrupteur n'est pas rendu (réglage en cours de lecture). */
  mounted = true,
): void {
  const state = useRef<{ spring: Spring | null }>({ spring: null })
  useLayoutEffect(() => {
    const sw = switchRef.current
    const thumb = sw?.querySelector<HTMLElement>(".settings-switch-thumb")
    if (!mounted || !sw || !thumb) return
    const paint = (p: number, v: number): void => {
      const stretch = Math.min(7, Math.abs(v) * 0.09)
      thumb.style.width = `${(20 + stretch).toFixed(2)}px`
      thumb.style.transform = `translateX(${(p * 18 - (v > 0 ? stretch : 0)).toFixed(2)}px)`
      const pct = Math.round(Math.max(0, Math.min(1, p)) * 100)
      sw.style.background = `color-mix(in srgb, var(--bcc-color-success) ${pct}%, var(--bcc-color-border))`
    }
    const target = checked ? 1 : 0
    if (!state.current.spring) {
      paint(target, 0)
      state.current.spring = spring(target, target, { stiffness: 520, damping: 24 }, paint)
      return
    }
    if (prefersReducedMotion()) state.current.spring.set(target)
    state.current.spring.retarget(target)
  }, [switchRef, checked, mounted])
  useLayoutEffect(() => {
    const current = state.current
    return () => current.spring?.stop()
  }, [])
}
