import { useEffect } from "react"
import type { RefObject } from "react"
import { impulse, pop, prefersReducedMotion, spring, stagger } from "./motion"
import { playSetupSound } from "./sound"

/** Trace un tracé SVG (coche) en ressort, quelle que soit sa longueur : `pathLength` le normalise. */
function drawShape(shape: SVGGeometryElement, delay = 0): void {
  if (prefersReducedMotion()) return
  shape.setAttribute("pathLength", "1")
  shape.style.strokeDasharray = "1"
  shape.style.strokeDashoffset = "1"
  setTimeout(() => {
    spring(1, 0, { stiffness: 240, damping: 19 }, (offset) => {
      shape.style.strokeDashoffset = offset <= 0.001 ? "" : offset.toFixed(3)
      if (offset <= 0.001) shape.style.strokeDasharray = ""
    })
  }, delay)
}

/** Secousse d'un élément (refus) : un ressort raide qu'on frappe, il oscille puis se pose. */
function shake(el: HTMLElement): void {
  if (prefersReducedMotion()) return
  spring(0, 0, { stiffness: 600, damping: 12, precision: 50 }, (x) => {
    el.style.translate = Math.abs(x) < 0.05 ? "" : `${x.toFixed(2)}px 0`
  }).kick(300)
}

function reveal(node: Element, selector: string, action: (el: HTMLElement) => void): void {
  if (node.matches(selector)) action(node as HTMLElement)
  node.querySelectorAll<HTMLElement>(selector).forEach(action)
}

/**
 * Physique et sons de l'assistant de configuration, branchés une fois sur la section d'une étape
 * (voir `OnboardingHeader`) : les blocs se posent en cascade, un champ qui prend le focus gonfle et
 * tinte, un choix (fournisseur d'IA) s'enclenche avec un « pop », une coche se dessine et éclot, une
 * erreur secoue sa ligne. Le son de réussite / d'échec reste joué par l'étape elle-même (le résultat
 * réel vient du main) ; ici, seulement les gestes qui ne dépendent d'aucun résultat.
 */
export function useOnboardingPhysics(headerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const section = headerRef.current?.closest<HTMLElement>(".onboarding-step")
    if (!section) return

    const rest = Array.from(section.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el !== headerRef.current)
    stagger(rest, 65, 90)

    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      playSetupSound("focus")
      impulse(target, -3)
    }
    const onClick = (event: MouseEvent): void => {
      const card = (event.target as Element | null)?.closest<HTMLElement>(".onboarding-ai-card")
      if (!card || !section.contains(card)) return
      playSetupSound("pop")
      impulse(card, 7)
      const icon = card.querySelector<HTMLElement>(".onboarding-ai-card-icon")
      if (icon) pop(icon, 40, 0.7)
    }
    section.addEventListener("focusin", onFocusIn)
    section.addEventListener("click", onClick)

    // Ce qui apparaît après coup (résultat d'une connexion, erreur) : on le voit arriver.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          reveal(node, ".onboarding-error", shake)
          reveal(node, ".onboarding-card-row--success", (row) => pop(row, 0, 0.94))
          reveal(node, ".onboarding-check", (check) => {
            pop(check, 60, 0.4)
            check.querySelectorAll<SVGGeometryElement>("path, polyline").forEach((shape) => drawShape(shape, 140))
          })
        })
      }
    })
    observer.observe(section, { childList: true, subtree: true })

    return () => {
      section.removeEventListener("focusin", onFocusIn)
      section.removeEventListener("click", onClick)
      observer.disconnect()
    }
  }, [headerRef])
}
