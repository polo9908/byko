import { useEffect, useLayoutEffect, useRef } from "react"
import { animate, bouncers, drawStroke, pop, prefersReducedMotion, spring, SPRINGS, tick } from "@renderer/lib/motion"
import type { Spring } from "@renderer/lib/motion"
import { colorOf, findMentions } from "@renderer/lib/people"
import { PersonText } from "./People"
import "./people.css"

/*
 * Briques animées de l'écran « Point d'équipe » (porté depuis le prototype d'étude de mouvement).
 * Toutes sont physiques (ressorts interruptibles, impulsions, gravité) et respectent
 * « réduire les animations » : l'état final s'affiche alors directement.
 */

const CHECK_PATH = "M2 6.5 L5 9.2 L10 3"

export function CheckIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className ?? "pointdequipe-check"} viewBox="0 0 12 12" aria-hidden="true">
      <path d={CHECK_PATH} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */

interface TypedTextProps {
  text: string
  typedChars: number
  /** Présents : leurs prénoms sont surlignés au fil de l'écriture. */
  people?: string[]
}

/**
 * Écriture en direct : chaque lettre révélée éclot en ressort, et le caret glisse derrière la
 * dernière (ressorts x/y : il suit aussi les retours à la ligne). Un texte déjà complet au
 * montage (rapport, correction) s'affiche sans rejouer l'écriture.
 */
export function TypedText({ text, typedChars, people = [] }: TypedTextProps): React.JSX.Element {
  const rootRef = useRef<HTMLSpanElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)
  const shownRef = useRef(typedChars)
  const textRef = useRef(text)
  const caretSprings = useRef<{ x: Spring; y: Spring } | null>(null)
  const typing = typedChars < text.length

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (textRef.current !== text) {
      // Correction du texte : rien à « écrire », on affiche tel quel.
      textRef.current = text
      shownRef.current = typedChars
      return
    }
    const reduce = prefersReducedMotion()
    for (let i = shownRef.current; i < typedChars; i++) {
      const letter = root.querySelector<HTMLElement>(`[data-i="${i}"]`)
      if (!letter || reduce) continue
      letter.style.opacity = "0"
      spring(0, 1, { stiffness: 520, damping: 21 }, (p) => {
        letter.style.opacity = p === 1 ? "" : String(Math.min(1, p * 1.7))
        letter.style.translate = p === 1 ? "" : `0 ${((1 - p) * 6).toFixed(2)}px`
        letter.style.scale = p === 1 ? "" : (0.72 + 0.28 * p).toFixed(3)
      })
    }
    shownRef.current = typedChars
    const caret = caretRef.current
    if (!caret) {
      caretSprings.current = null
      return
    }
    const last = root.querySelector<HTMLElement>(`[data-i="${typedChars - 1}"]`)
    const x = last ? last.offsetLeft + last.offsetWidth + 1 : 0
    const y = last ? last.offsetTop + (last.offsetHeight - 14) / 2 : 0
    if (!caretSprings.current) {
      caret.style.left = `${x}px`
      caret.style.top = `${y}px`
      caretSprings.current = {
        // Raide : l'app écrit une lettre toutes les 28 ms, le caret doit coller à la dernière.
        x: spring(x, x, { stiffness: 2400, damping: 90, precision: 50 }, (v) => {
          if (caretRef.current) caretRef.current.style.left = `${v.toFixed(2)}px`
        }),
        y: spring(y, y, { stiffness: 900, damping: 50, precision: 50 }, (v) => {
          if (caretRef.current) caretRef.current.style.top = `${v.toFixed(2)}px`
        }),
      }
      return
    }
    caretSprings.current.x.retarget(x)
    caretSprings.current.y.retarget(y)
  }, [text, typedChars])

  // Mots insécables (pas de coupure entre deux lettres), espaces en texte pour couper entre les mots.
  const visible = text.slice(0, typedChars)
  const mentions = findMentions(text, people)
  const nodes: React.ReactNode[] = []
  let index = 0
  visible.split(" ").forEach((word, wordIndex) => {
    if (wordIndex > 0) {
      nodes.push(" ")
      index++
    }
    nodes.push(
      <span key={`w${index}`} className="motion-word">
        {Array.from(word, (char) => {
          const i = index++
          const mention = mentions.find((m) => i >= m.start && i < m.end)
          return (
            <span
              key={i}
              className={mention ? `motion-letter person-mark person-mark--${colorOf(mention.person)}` : "motion-letter"}
              data-i={i}
            >
              {char}
            </span>
          )
        })}
      </span>,
    )
  })

  return (
    <span ref={rootRef} className="pointdequipe-item-text motion-typing">
      {nodes}
      {typing && <span ref={caretRef} className="pointdequipe-caret motion-caret" aria-hidden="true" />}
    </span>
  )
}

/* ------------------------------------------------------------------ */

interface WrittenTextProps {
  text: string
  className: string
  onDone: () => void
  people?: string[]
}

/** Le compte rendu s'écrit mot à mot (chaque mot éclot, le caret suit), puis `onDone`. */
export function WrittenText({ text, className, onDone, people = [] }: WrittenTextProps): React.JSX.Element {
  const words = text.split(/(\s+)/)
  const wordCount = words.filter((w) => w.trim() !== "").length
  const rootRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLSpanElement>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const root = rootRef.current
    const caret = caretRef.current
    if (!root || !caret) return
    const units = Array.from(root.querySelectorAll<HTMLElement>(".motion-letter"))
    if (prefersReducedMotion() || units.length === 0) {
      units.forEach((u) => (u.style.opacity = ""))
      onDoneRef.current()
      return
    }
    const cx = spring(0, 0, { stiffness: 900, damping: 48, precision: 50 }, (v) => {
      caret.style.left = `${v.toFixed(2)}px`
    })
    const cy = spring(0, 0, { stiffness: 520, damping: 30, precision: 50 }, (v) => {
      caret.style.top = `${v.toFixed(2)}px`
    })
    let i = 0
    let timer: ReturnType<typeof setTimeout>
    const next = (): void => {
      if (i >= units.length) {
        spring(1, 0, SPRINGS.snappy, (p) => (caret.style.opacity = String(Math.max(0, p))))
        onDoneRef.current()
        return
      }
      const u = units[i++]
      spring(0, 1, { stiffness: 520, damping: 21 }, (p) => {
        u.style.opacity = p === 1 ? "" : String(Math.min(1, p * 1.7))
        u.style.translate = p === 1 ? "" : `0 ${((1 - p) * 6).toFixed(2)}px`
        u.style.scale = p === 1 ? "" : (0.72 + 0.28 * p).toFixed(3)
      })
      cx.retarget(u.offsetLeft + u.offsetWidth + 1)
      cy.retarget(u.offsetTop + (u.offsetHeight - 14) / 2)
      timer = setTimeout(next, 48 + Math.random() * 40 + (/[,.;:]$/.test(u.textContent ?? "") ? 170 : 0))
    }
    timer = setTimeout(next, 80)
    return () => {
      clearTimeout(timer)
      cx.stop()
      cy.stop()
    }
  }, [text])

  return (
    <div ref={rootRef} className={`${className} motion-typing`} aria-label={text}>
      {words.map((w, i) =>
        w.trim() === "" ? (
          w
        ) : (
          <span key={i} className="motion-letter motion-word" style={{ opacity: 0 }} aria-hidden="true">
            <PersonText text={w} people={people} />
          </span>
        ),
      )}
      {wordCount > 0 && <span ref={caretRef} className="pointdequipe-caret motion-caret" aria-hidden="true" />}
    </div>
  )
}

/* ------------------------------------------------------------------ */

type ChipStatus = "saving" | "saved" | "error" | "removed"

interface JiraChipProps {
  status: ChipStatus
  jiraKey?: string
  url?: string
  error?: string
}

/**
 * Étiquette Jira d'une tâche. Création en cours : trois balles rebondissent (gravité). Ticket
 * créé : la largeur se transforme en ressort, la clé monte, la coche se trace. Échec : l'étiquette
 * secoue (impulsion latérale). Tâche retirée : « supprimé ».
 */
export function JiraChip({ status, jiraKey, url, error }: JiraChipProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const widthRef = useRef(0)
  const statusRef = useRef<ChipStatus | null>(null)

  useLayoutEffect(() => {
    const chip = ref.current
    if (!chip) return
    const previous = statusRef.current
    statusRef.current = status
    const naturalWidth = chip.getBoundingClientRect().width
    const fromWidth = widthRef.current
    widthRef.current = naturalWidth
    if (previous === null) {
      pop(chip, 0, 0.5)
    } else if (previous !== status && !prefersReducedMotion()) {
      // La largeur passe de l'ancien contenu au nouveau en ressort, le contenu monte.
      chip.style.width = `${fromWidth}px`
      const ws = spring(fromWidth, naturalWidth, { stiffness: 380, damping: 21, precision: 50 }, (w, v) => {
        chip.style.width = v === 0 && w === ws.target ? "" : `${w.toFixed(2)}px`
      })
      const inner = chip.firstElementChild as HTMLElement | null
      if (inner) {
        void animate(SPRINGS.bouncy, (p) => {
          inner.style.translate = p === 1 ? "" : `0 ${((1 - p) * 9).toFixed(2)}px`
          inner.style.opacity = p === 1 ? "" : String(Math.min(1, p * 1.6))
        })
      }
      if (status === "error") {
        let x = 0
        let v = 340
        tick((dt) => {
          v += (-900 * x - 14 * v) * dt
          x += v * dt
          chip.style.translate = `${x.toFixed(2)}px 0`
          if (Math.abs(x) < 0.05 && Math.abs(v) < 1) {
            chip.style.translate = ""
            return true
          }
          return !chip.isConnected
        })
      }
    }
    if (status === "saved") {
      const path = chip.querySelector("path")
      if (path && previous !== "saved") drawStroke(path)
    }
    if (status === "saving") {
      return bouncers(chip.querySelectorAll<HTMLElement>(".pointdequipe-dots i"), {
        gravity: 1500,
        kick: 80,
        restitution: 0.5,
        stagger: 0.11,
        pause: 0.12,
      })
    }
    return undefined
  }, [status])

  let content: React.ReactNode
  if (status === "saved" && jiraKey) {
    content = url ? (
      <a href={url} target="_blank" rel="noreferrer">
        {jiraKey}
        <CheckIcon />
      </a>
    ) : (
      <>
        {jiraKey}
        <CheckIcon />
      </>
    )
  } else if (status === "error") {
    content = error ?? "Échec de création du ticket"
  } else if (status === "removed") {
    content = jiraKey ? `${jiraKey} supprimé` : "Ticket annulé"
  } else {
    content = (
      <>
        Création du ticket
        <span className="pointdequipe-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </>
    )
  }
  const modifier = status === "removed" ? "error" : status
  return (
    <span ref={ref} className={`pointdequipe-item-jira pointdequipe-item-jira--${modifier} motion-chip`}>
      <span className="motion-chip-inner">{content}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */

/** Compteur à rouleaux : chaque chiffre est un ressort qui roule (et dépasse un peu). */
export function Odometer({ value, className }: { value: string; className?: string }): React.JSX.Element {
  const rootRef = useRef<HTMLSpanElement>(null)
  const cols = useRef(new Map<number, { digit: number; pos: number; spring: Spring }>())
  const lengthRef = useRef(value.length)
  const previousRef = useRef(value)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (lengthRef.current !== value.length) {
      cols.current.forEach((c) => c.spring.stop())
      cols.current.clear()
      lengthRef.current = value.length
    }
    const backwards = Number(value.replace(/\D/g, "")) < Number(previousRef.current.replace(/\D/g, ""))
    previousRef.current = value
    const reduce = prefersReducedMotion()
    Array.from(value).forEach((char, i) => {
      if (!/\d/.test(char)) return
      const stack = root.querySelector<HTMLElement>(`[data-col="${i}"]`)
      if (!stack) return
      const digit = Number(char)
      const show = (v: number): void => {
        const m = ((v % 10) + 10) % 10
        stack.style.transform = `translateY(${(-m * 1.25).toFixed(4)}em)`
      }
      const col = cols.current.get(i)
      if (!col) {
        show(digit)
        cols.current.set(i, {
          digit,
          pos: digit,
          spring: spring(digit, digit, { stiffness: 380, damping: 17 }, show),
        })
        return
      }
      if (col.digit === digit) return
      col.pos += backwards ? -((col.digit - digit + 10) % 10) : (digit - col.digit + 10) % 10
      col.digit = digit
      if (reduce) col.spring.set(col.pos)
      col.spring.retarget(col.pos)
    })
  }, [value])

  useEffect(() => {
    const current = cols.current
    return () => current.forEach((c) => c.spring.stop())
  }, [])

  return (
    <span ref={rootRef} className={`motion-odo ${className ?? ""}`}>
      <span className="motion-sr-only">{value}</span>
      {Array.from(value).map((char, i) =>
        /\d/.test(char) ? (
          <span key={`${value.length}-${i}`} className="motion-odo-col" aria-hidden="true">
            <span className="motion-odo-stack" data-col={i}>
              {"01234567890".split("").map((d, j) => (
                <span key={j}>{d}</span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${value.length}-${i}`} aria-hidden="true">
            {char}
          </span>
        ),
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */

interface WaveBarsProps {
  count: number
  /** Niveaux du micro (0–255 par bande), lus à chaque image ; `null` = silence. */
  readLevels: () => Uint8Array | null
}

/**
 * Onde : chaîne de ressorts couplés. Chaque barre est tirée vers le niveau réel du micro et
 * entraîne ses voisines ; un pic se propage, déborde un peu et s'amortit. Rendu impératif
 * (aucun re-rendu React par image).
 */
export function WaveBars({ count, readLevels }: WaveBarsProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const readRef = useRef(readLevels)
  readRef.current = readLevels

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const bars = Array.from(root.children) as HTMLElement[]
    const n = bars.length
    const y = new Float32Array(n).fill(2)
    const v = new Float32Array(n)
    const reduce = prefersReducedMotion()
    const K = 520 // rappel vers le niveau du micro
    const COUPLING = 900 // entraînement des voisines : le pic se propage
    const D = 20
    return tick((dt) => {
      if (!root.isConnected) return true
      const levels = readRef.current()
      const h = dt / 3
      for (let s = 0; s < 3; s++) {
        for (let i = 0; i < n; i++) {
          const level = levels ? (levels[Math.min(levels.length - 1, i)] ?? 0) : 0
          const target = Math.max(2, (level / 255) * 22)
          if (reduce) {
            y[i] = target
            continue
          }
          const l = i > 0 ? y[i - 1] : y[i]
          const r = i < n - 1 ? y[i + 1] : y[i]
          v[i] += (K * (target - y[i]) + COUPLING * (l + r - 2 * y[i]) - D * v[i]) * h
        }
        if (!reduce) for (let i = 0; i < n; i++) y[i] += v[i] * h
      }
      for (let i = 0; i < n; i++) bars[i].style.height = `${Math.max(2, Math.min(24, y[i])).toFixed(1)}px`
      return false
    })
  }, [count])

  return (
    <div ref={rootRef} className="pointdequipe-waveform" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="pointdequipe-wave-bar" />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */

export type SendState = "idle" | "sending" | "success"

interface SendButtonProps {
  state: SendState
  label: string
  disabled?: boolean
  onClick: () => void
}

/**
 * Bouton d'envoi : à l'envoi il se resserre en cercle (largeur en ressort, petit rebond) et une
 * roue accélère ; au succès une coche se trace et le bouton rebondit ; en cas d'échec il reprend
 * sa largeur (ressort) pour proposer « Réessayer ».
 */
export function SendButton({ state, label, disabled, onClick }: SendButtonProps): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const naturalRef = useRef<{ width: number; height: number } | null>(null)
  const widthSpring = useRef<Spring | null>(null)

  useLayoutEffect(() => {
    const button = ref.current
    if (!button) return
    if (state === "idle") {
      if (!naturalRef.current || !widthSpring.current) return
      // Échec : le bouton reprend sa largeur naturelle.
      const from = button.getBoundingClientRect().width
      button.style.width = ""
      button.style.padding = ""
      const to = button.getBoundingClientRect().width
      button.style.width = `${from}px`
      widthSpring.current.set(from)
      widthSpring.current.retarget(to)
      naturalRef.current = null
      return
    }
    if (state === "sending") {
      const r = button.getBoundingClientRect()
      naturalRef.current = { width: r.width, height: r.height }
      button.style.height = `${r.height}px`
      button.style.padding = "0"
      if (prefersReducedMotion()) {
        button.style.width = `${r.height}px`
        return
      }
      button.style.width = `${r.width}px`
      widthSpring.current = spring(r.width, r.height, { stiffness: 260, damping: 17, precision: 50 }, (w, v) => {
        if (naturalRef.current === null && v === 0) {
          button.style.width = ""
          button.style.height = ""
          return
        }
        button.style.width = `${w.toFixed(2)}px`
      })
      const wheel = button.querySelector<SVGElement>(".motion-spin")
      let angle = 0
      let speed = 0
      const accel = spring(0, 720, { stiffness: 40, damping: 12, precision: 100 }, (s) => (speed = s))
      return tick((dt) => {
        if (!wheel || !wheel.isConnected) {
          accel.stop()
          return true
        }
        angle += speed * dt
        wheel.style.rotate = `${angle.toFixed(1)}deg`
        return false
      })
    }
    // Succès : coche tracée, le bouton rebondit.
    const path = button.querySelector("path")
    if (path) drawStroke(path)
    if (!prefersReducedMotion()) {
      const s = spring(1, 1, { stiffness: 420, damping: 12 }, (v) => (button.style.scale = v.toFixed(4)))
      s.kick(5)
    }
    return undefined
  }, [state])

  return (
    <button
      ref={ref}
      type="button"
      className="onboarding-button onboarding-button--primary motion-send"
      // Pas de `disabled` pendant l'envoi : le style de l'app grise les boutons désactivés, alors que le cercle doit
      // rester plein. Le double envoi est déjà bloqué par la garde synchrone de l'appelant.
      disabled={disabled}
      aria-disabled={state !== "idle"}
      aria-busy={state === "sending"}
      onClick={() => {
        if (state === "idle") onClick()
      }}
    >
      {state === "idle" && label}
      {state === "sending" && (
        <>
          <span className="motion-sr-only">Envoi…</span>
          <svg className="motion-spin" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="7" />
          </svg>
        </>
      )}
      {state === "success" && (
        <>
          <span className="motion-sr-only">Envoyé</span>
          <CheckIcon className="motion-send-check" />
        </>
      )}
    </button>
  )
}
