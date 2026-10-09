/**
 * Moteur de mouvement physique du renderer (porté depuis le prototype d'étude de mouvement).
 *
 * Tout passe par des ressorts interruptibles qui gardent position ET vitesse : une animation
 * interrompue repart de là où elle est, avec son élan. S'y ajoutent des impulsions (`kick`),
 * de la gravité et des trajectoires balistiques pour les gestes « matériels » (chute, lancer,
 * envol d'un ticket).
 *
 * Les helpers DOM écrivent dans les propriétés individuelles `translate`, `scale` et `rotate`
 * (et non `transform`) : elles se composent avec les transformations déjà posées par le CSS
 * de l'app (ex. `translateX(-50%)` des jalons de la frise) au lieu de les écraser.
 *
 * Tous respectent « réduire les animations » du système : l'état final est appliqué tout de suite.
 */

export interface SpringConfig {
  stiffness: number
  damping: number
  mass?: number
  /** Échelle de tolérance d'arrêt : 1 pour des valeurs 0→1, ~50 pour des pixels. */
  precision?: number
}

export const SPRINGS = {
  gentle: { stiffness: 170, damping: 22 },
  snappy: { stiffness: 320, damping: 26 },
  bouncy: { stiffness: 420, damping: 20 },
} satisfies Record<string, SpringConfig>

export interface Spring {
  readonly target: number
  /** Change la cible sans perdre l'élan (réarme le ressort s'il s'était posé). */
  retarget(target: number): void
  /** Ajoute de la vitesse : un choc, un battement, un atterrissage. */
  kick(velocity: number): void
  /** Saute à une position sans toucher à la vitesse (réagencement FLIP). */
  set(value: number): void
  value(): number
  stop(): void
}

type Step = (dt: number) => boolean

const steps: Step[] = []
let rafId: number | null = null
let lastTime = 0

function loop(time: number): void {
  let dt = (time - lastTime) / 1000
  if (!(dt > 0)) dt = 1 / 60
  dt = Math.min(0.032, dt)
  lastTime = time
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i](dt)) steps.splice(i, 1)
  }
  rafId = steps.length > 0 ? requestAnimationFrame(loop) : null
}

function schedule(step: Step): void {
  steps.push(step)
  if (rafId === null) {
    lastTime = performance.now()
    rafId = requestAnimationFrame(loop)
  }
}

/** Boucle physique libre : `step(dt)` renvoie true pour s'arrêter. Renvoie une fonction d'annulation. */
export function tick(step: (dt: number) => boolean | void): () => void {
  let cancelled = false
  schedule((dt) => cancelled || step(dt) === true)
  return () => {
    cancelled = true
  }
}

export function spring(
  from: number,
  to: number,
  config: SpringConfig,
  onUpdate: (value: number, velocity: number) => void,
): Spring {
  let x = from
  let v = 0
  let active = false
  let stopped = false
  const k = config.stiffness
  const c = config.damping
  const m = config.mass ?? 1
  const precision = config.precision ?? 1
  const handle = {
    target: to,
    retarget(next: number): void {
      handle.target = next
      wake()
    },
    kick(velocity: number): void {
      v += velocity
      wake()
    },
    set(value: number): void {
      x = value
      onUpdate(x, v)
      wake()
    },
    value: () => x,
    stop(): void {
      stopped = true
    },
  }
  function wake(): void {
    stopped = false
    if (active) return
    active = true
    schedule((dt) => {
      if (stopped) {
        active = false
        return true
      }
      // Sous-pas : un ressort raide (ex. caret) resterait instable sur une image longue (32 ms).
      const n = Math.max(1, Math.ceil(Math.max((c / m) * dt, Math.sqrt(k / m) * dt * 2)))
      const h = dt / n
      for (let i = 0; i < n; i++) {
        const a = (-k * (x - handle.target) - c * v) / m
        v += a * h
        x += v * h
      }
      if (Math.abs(v) < 0.006 * precision && Math.abs(x - handle.target) < 0.0008 * precision) {
        x = handle.target
        v = 0
        onUpdate(x, 0)
        active = false
        return true
      }
      onUpdate(x, v)
      return false
    })
  }
  wake()
  return handle
}

/** Ressort 0→1 qui se résout quand il se pose (ou tout de suite si les animations sont réduites). */
export function animate(config: SpringConfig, onUpdate: (progress: number, velocity: number) => void): Promise<void> {
  return new Promise((resolve) => {
    if (prefersReducedMotion()) {
      onUpdate(1, 0)
      resolve()
      return
    }
    spring(0, 1, config, (p, v) => {
      onUpdate(p, v)
      if (v === 0 && p === 1) resolve()
    })
  })
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      // Choix explicite dans Réglages > Accessibilité (lib/accessibility.ts).
      document.documentElement.hasAttribute("data-a11y-motion"))
  )
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

/* ------------------------------------------------------------------ */
/* Gestes                                                              */
/* ------------------------------------------------------------------ */

/** Entrée : glisse vers le haut et s'éclaircit. */
export function enter(el: HTMLElement, delay = 0, distance = 14): void {
  if (prefersReducedMotion()) return
  el.style.opacity = "0"
  el.style.translate = `0 ${distance}px`
  setTimeout(() => {
    spring(0, 1, SPRINGS.snappy, (p) => {
      el.style.opacity = String(Math.min(1, p * 1.7))
      el.style.translate = p === 1 ? "" : `0 ${((1 - p) * distance).toFixed(2)}px`
      if (p === 1) el.style.opacity = ""
    })
  }, delay)
}

export function stagger(els: Iterable<HTMLElement>, step = 55, startDelay = 0): void {
  let i = 0
  for (const el of els) enter(el, startDelay + step * i++)
}

/** Éclosion : gonfle de `from` à 1 en dépassant (ressort rebondissant). */
export function pop(el: HTMLElement, delay = 0, from = 0.6): void {
  if (prefersReducedMotion()) return
  el.style.opacity = "0"
  el.style.scale = String(from)
  setTimeout(() => {
    spring(0, 1, SPRINGS.bouncy, (p) => {
      el.style.opacity = p === 1 ? "" : String(Math.min(1, p * 2))
      el.style.scale = p === 1 ? "" : (from + (1 - from) * p).toFixed(4)
    })
  }, delay)
}

/** Ressort d'échelle attaché à un élément, pour lui donner des impulsions (battement, atterrissage). */
export function scaleSpring(el: HTMLElement, config: SpringConfig = { stiffness: 420, damping: 12 }): Spring {
  return spring(1, 1, config, (value) => {
    el.style.scale = value === 1 ? "" : value.toFixed(4)
  })
}

/* Un seul ressort d'échelle par élément, partagé par la pression et les impulsions : jamais deux
   animations concurrentes sur la même propriété. */
const scaleSprings = new WeakMap<HTMLElement, Spring>()

function sharedScaleSpring(el: HTMLElement, config: SpringConfig): Spring {
  let s = scaleSprings.get(el)
  if (!s) {
    s = scaleSpring(el, config)
    scaleSprings.set(el, s)
  }
  return s
}

/** Impulsion d'échelle : positive, l'élément s'enfonce puis rebondit ; négative, il se tasse. */
export function impulse(el: HTMLElement, velocity: number): void {
  if (prefersReducedMotion()) return
  sharedScaleSpring(el, { stiffness: 420, damping: 12 }).kick(velocity)
}

/** Chute : saute un peu, puis tombe (gravité) en tournant et s'efface. */
export function drop(el: HTMLElement): void {
  if (prefersReducedMotion()) {
    el.style.opacity = "0"
    return
  }
  let y = 0
  let vy = -150 - Math.random() * 90
  let rot = 0
  const vr = (Math.random() - 0.5) * 70
  let life = 0
  tick((dt) => {
    life += dt
    vy += 2600 * dt
    y += vy * dt
    rot += vr * dt
    el.style.translate = `0 ${y.toFixed(1)}px`
    el.style.rotate = `${rot.toFixed(2)}deg`
    el.style.opacity = String(Math.max(0, 1 - life * 2.3))
    return life > 0.45 || !el.isConnected
  })
}

/** Lancer vers le haut : l'élément part (vitesse initiale), freine, s'efface. */
export function fling(el: HTMLElement, delay = 0): void {
  if (prefersReducedMotion()) {
    el.style.opacity = "0"
    return
  }
  setTimeout(() => {
    let y = 0
    let vy = -700 - Math.random() * 300
    let life = 0
    const rot = (Math.random() - 0.5) * 6
    tick((dt) => {
      life += dt
      vy += 1500 * dt
      y += vy * dt
      el.style.translate = `0 ${y.toFixed(1)}px`
      el.style.rotate = `${(rot * life * 4).toFixed(2)}deg`
      el.style.opacity = String(Math.max(0, 1 - life * 3))
      return life > 0.35 || !el.isConnected
    })
  }, delay)
}

/** Arrivée en chute libre : tombe d'en haut, rebondit en s'écrasant, se pose. */
export function dropIn(el: HTMLElement, delay = 0): void {
  if (prefersReducedMotion()) return
  el.style.opacity = "0"
  setTimeout(() => {
    let y = -80
    let vy = 0
    let q = 0
    let vq = 0
    el.style.opacity = ""
    el.style.transformOrigin = "50% 100%"
    tick((dt) => {
      if (!el.isConnected) return true
      vy += 3000 * dt
      y += vy * dt
      if (y > 0) {
        y = 0
        vq += Math.min(9, vy / 260)
        vy = -vy * 0.36
        if (Math.abs(vy) < 70) vy = 0
      }
      vq += (-520 * q - 15 * vq) * dt
      q += vq * dt
      if (vy === 0 && y === 0 && Math.abs(q) < 0.002 && Math.abs(vq) < 0.02) {
        el.style.translate = ""
        el.style.scale = ""
        return true
      }
      el.style.translate = `0 ${y.toFixed(1)}px`
      el.style.scale = `${(1 + q * 0.5).toFixed(4)} ${(1 - q).toFixed(4)}`
      return false
    })
  }, delay)
}

/** Pichenette latérale : vitesse initiale, frottement, s'efface en tournant légèrement. */
export function flick(el: HTMLElement, direction: 1 | -1 = 1): void {
  if (prefersReducedMotion()) {
    el.style.opacity = "0"
    return
  }
  let x = 0
  let v = 1100 * direction
  let life = 0
  tick((dt) => {
    life += dt
    v *= Math.exp(-2.4 * dt)
    x += v * dt
    el.style.translate = `${x.toFixed(1)}px 0`
    el.style.rotate = `${(x * 0.014).toFixed(2)}deg`
    el.style.opacity = String(Math.max(0, 1 - Math.abs(x) / 300))
    return Math.abs(x) > 300 || life > 1.2 || !el.isConnected
  })
}

/** Referme un élément en hauteur (ressort), marges et rembourrage compris. */
export function collapse(el: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve()
  const style = getComputedStyle(el)
  const height = el.getBoundingClientRect().height
  const pt = parseFloat(style.paddingTop) || 0
  const pb = parseFloat(style.paddingBottom) || 0
  const mb = parseFloat(style.marginBottom) || 0
  el.style.boxSizing = "border-box"
  el.style.overflow = "hidden"
  return new Promise((resolve) => {
    spring(1, 0, { stiffness: 240, damping: 25 }, (p, v) => {
      const q = Math.max(0, p)
      el.style.height = `${(height * q).toFixed(2)}px`
      el.style.paddingTop = `${pt * q}px`
      el.style.paddingBottom = `${pb * q}px`
      el.style.marginBottom = `${mb * q}px`
      if (v === 0 && p === 0) resolve()
    })
  })
}

/** Petites balles qui rebondissent (gravité + restitution) : chargeur « physique ». Renvoie l'arrêt. */
export function bouncers(
  nodes: Iterable<HTMLElement>,
  options: {
    gravity?: number
    kick?: number
    restitution?: number
    stagger?: number
    pause?: number
    squash?: boolean
  } = {},
): () => void {
  const g = options.gravity ?? 1800
  const kick = options.kick ?? 95
  const rest = options.restitution ?? 0.55
  const balls = Array.from(nodes, (node, i) => ({
    node,
    y: 0,
    v: 0,
    sq: 0,
    wait: i * (options.stagger ?? 0.12),
  }))
  if (prefersReducedMotion() || balls.length === 0) return () => undefined
  return tick((dt) => {
    if (!balls[0].node.isConnected) return true
    for (const b of balls) {
      if (b.wait > 0) {
        b.wait -= dt
        if (b.wait <= 0) b.v = -kick
        continue
      }
      b.v += g * dt
      b.y += b.v * dt
      if (b.y > 0) {
        b.y = 0
        const impact = b.v
        b.v = -b.v * rest
        if (Math.abs(b.v) < kick * 0.35) {
          b.v = 0
          b.wait = options.pause ?? 0.05
        }
        if (options.squash) b.sq = Math.min(0.35, impact / 2200)
      }
      b.sq *= Math.exp(-dt * 18)
      b.node.style.translate = `0 ${b.y.toFixed(2)}px`
      b.node.style.scale = `${(1 + b.sq).toFixed(3)} ${(1 - b.sq).toFixed(3)}`
    }
    return false
  })
}

/**
 * Point « en direct » : un cœur qui bat (impulsions), un halo qui s'étend, et `energy()` (la
 * voix) qui le fait gonfler. Renvoie l'arrêt ; s'arrête aussi seul quand le point quitte le DOM.
 */
export function heartbeat(dot: HTMLElement, energy?: () => number): () => void {
  if (prefersReducedMotion()) return () => undefined
  dot.style.animation = "none"
  dot.style.position = "relative"
  const halo = document.createElement("span")
  halo.className = "motion-halo"
  halo.setAttribute("aria-hidden", "true")
  dot.appendChild(halo)
  const beat = spring(1, 1, { stiffness: 380, damping: 13 }, (value) => {
    dot.style.scale = value.toFixed(4)
  })
  let since = 0.9
  const cancel = tick((dt) => {
    if (!dot.isConnected) return true
    since += dt
    if (since > 1.05) {
      since = 0
      beat.kick(6)
      spring(0, 1, { stiffness: 55, damping: 11 }, (p) => {
        halo.style.scale = (1 + p * 1.9).toFixed(3)
        halo.style.opacity = String(Math.max(0, 0.42 * (1 - p)))
      })
    }
    beat.retarget(1 + (energy ? Math.min(0.32, Math.max(0, energy())) : 0))
    return false
  })
  return () => {
    cancel()
    beat.stop()
    halo.remove()
    dot.style.scale = ""
    dot.style.animation = ""
  }
}

/** Trace une coche SVG (trait qui se dessine en ressort). */
export function drawStroke(path: SVGPathElement, length = 14, delay = 0): void {
  if (prefersReducedMotion()) return
  path.style.strokeDasharray = String(length)
  path.style.strokeDashoffset = String(length)
  setTimeout(() => {
    spring(length, 0, { stiffness: 240, damping: 19 }, (offset) => {
      path.style.strokeDashoffset = offset.toFixed(2)
    })
  }, delay)
}

/**
 * Morphose liquide d'un rectangle vers un élément : un « fantôme » en position fixe, dont x, y,
 * largeur, hauteur et rayon ont chacun leur ressort ; la largeur, plus souple, s'étire en
 * dépassant (effet goutte qui s'étale). Un point optionnel (ex. le point rouge) suit sa propre
 * trajectoire. Le fantôme disparaît une fois la cible révélée.
 */
export function morphFromRect(
  from: DOMRect,
  target: HTMLElement,
  options: {
    radius: number
    className: string
    dot?: { from: DOMRect; to: HTMLElement; className: string }
  },
): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve()
  const to = target.getBoundingClientRect()
  const ghost = document.createElement("div")
  ghost.className = options.className
  ghost.setAttribute("aria-hidden", "true")
  const dotEl = options.dot ? document.createElement("span") : null
  if (dotEl && options.dot) {
    dotEl.className = options.dot.className
    ghost.appendChild(dotEl)
  }
  document.body.appendChild(ghost)
  const dotTo = options.dot?.to.getBoundingClientRect()
  const s = {
    x: from.left,
    y: from.top,
    w: from.width,
    h: from.height,
    r: from.height / 2,
    dx: options.dot ? options.dot.from.left : 0,
    dy: options.dot ? options.dot.from.top : 0,
    ds: options.dot ? options.dot.from.width : 0,
  }
  const draw = (): void => {
    ghost.style.left = `${s.x.toFixed(2)}px`
    ghost.style.top = `${s.y.toFixed(2)}px`
    ghost.style.width = `${Math.max(0, s.w).toFixed(2)}px`
    ghost.style.height = `${Math.max(0, s.h).toFixed(2)}px`
    ghost.style.borderRadius = `${Math.max(0, s.r).toFixed(2)}px`
    if (dotEl) {
      dotEl.style.left = `${(s.dx - s.x).toFixed(2)}px`
      dotEl.style.top = `${(s.dy - s.y).toFixed(2)}px`
      dotEl.style.width = dotEl.style.height = `${Math.max(0, s.ds).toFixed(2)}px`
    }
  }
  const go = (key: keyof typeof s, value: number, k: number, c: number): void => {
    spring(s[key], value, { stiffness: k, damping: c, precision: 50 }, (v) => {
      s[key] = v
      draw()
    })
  }
  draw()
  go("x", to.left, 240, 22)
  go("w", to.width, 150, 13)
  go("y", to.top, 300, 24)
  go("h", to.height, 330, 20)
  go("r", options.radius, 300, 26)
  if (dotTo) {
    go("dx", dotTo.left, 260, 22)
    go("dy", dotTo.top, 260, 22)
    go("ds", dotTo.width, 320, 18)
  }
  return wait(430).then(() => {
    spring(1, 0, SPRINGS.snappy, (p) => {
      ghost.style.opacity = String(Math.max(0, p))
      if (p === 0) ghost.remove()
    })
  })
}

/**
 * Copie figée d'un élément, posée par-dessus à la même place, dont les enfants s'envolent : sert
 * à faire partir un écran que React vient (ou va) démonter.
 */
export function flingAwayCopy(el: HTMLElement, skip?: (child: Element) => boolean): void {
  if (prefersReducedMotion()) return
  const rect = el.getBoundingClientRect()
  const copy = el.cloneNode(true) as HTMLElement
  copy.setAttribute("aria-hidden", "true")
  copy.removeAttribute("id")
  Object.assign(copy.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "50",
  })
  document.body.appendChild(copy)
  Array.from(copy.children).forEach((child, i) => {
    if (skip?.(child)) {
      ;(child as HTMLElement).style.visibility = "hidden"
      return
    }
    fling(child as HTMLElement, i * 35)
  })
  setTimeout(() => copy.remove(), 900)
}

/**
 * Trajectoire balistique d'un petit élément (ex. un ticket Jira) d'un point à un autre :
 * il décolle, monte en arc sous la gravité, tourne, rapetisse et se pose sur la cible.
 */
export function flyTo(from: DOMRect, target: HTMLElement, content: HTMLElement): Promise<void> {
  const to = target.getBoundingClientRect()
  if (prefersReducedMotion()) return Promise.resolve()
  content.setAttribute("aria-hidden", "true")
  document.body.appendChild(content)
  const w = content.offsetWidth
  const h = content.offsetHeight
  const x0 = from.left + from.width / 2
  const y0 = from.top + from.height / 2
  const x1 = to.left + to.width / 2
  const y1 = to.top + to.height / 2
  const T = 0.72
  const g = 2600
  const vx = (x1 - x0) / T
  const vy = (y1 - y0 - 0.5 * g * T * T) / T
  const spin = (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 120)
  let t = 0
  return new Promise((resolve) => {
    tick((dt) => {
      t += dt
      const k = Math.min(t, T)
      const lift = Math.min(1, t / 0.12)
      const px = x0 + vx * k
      const py = y0 + vy * k + 0.5 * g * k * k
      content.style.translate = `${(px - w / 2).toFixed(1)}px ${(py - h / 2).toFixed(1)}px`
      content.style.rotate = `${(spin * k).toFixed(1)}deg`
      content.style.scale = ((0.6 + 0.4 * lift) * (1 - 0.5 * (k / T))).toFixed(3)
      content.style.opacity = String(k > T * 0.82 ? Math.max(0, (T - k) / (T * 0.18)) : 1)
      if (t >= T) {
        content.remove()
        resolve()
        return true
      }
      return false
    })
  })
}

/* ------------------------------------------------------------------ */
/* Pression physique de toutes les commandes                           */
/* ------------------------------------------------------------------ */

const PRESSABLE = "button:not(:disabled), a.journal-ticket-row, [data-pressable]"

function pressSpringOf(el: HTMLElement): Spring {
  return sharedScaleSpring(el, SPRINGS.bouncy)
}

/**
 * Pression « physique » de toutes les commandes de l'app, par délégation (une seule écoute,
 * valable aussi pour les éléments rendus plus tard) : le bouton se comprime, puis rebondit.
 * Les éléments marqués `data-no-press` (ex. pastilles de la frise, la goutte s'en charge) sont exclus.
 */
export function installPressPhysics(): () => void {
  let pressed: HTMLElement | null = null
  const target = (event: Event): HTMLElement | null => {
    const el = (event.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null
    return el && !el.closest("[data-no-press]") ? el : null
  }
  const down = (event: PointerEvent): void => {
    if (prefersReducedMotion() || event.button !== 0) return
    pressed = target(event)
    if (pressed) pressSpringOf(pressed).retarget(0.94)
  }
  const release = (): void => {
    if (!pressed) return
    const el = pressed
    pressed = null
    const s = pressSpringOf(el)
    s.retarget(1.03)
    setTimeout(() => s.retarget(1), 70)
  }
  document.addEventListener("pointerdown", down, true)
  document.addEventListener("pointerup", release, true)
  document.addEventListener("pointercancel", release, true)
  window.addEventListener("blur", release)
  return () => {
    document.removeEventListener("pointerdown", down, true)
    document.removeEventListener("pointerup", release, true)
    document.removeEventListener("pointercancel", release, true)
    window.removeEventListener("blur", release)
  }
}

export { clamp01 }
