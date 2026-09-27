/**
 * Sound design repris à l'identique du prototype BCC (`BCC Medium.html`), y
 * compris dans sa structure : le prototype embarque **deux** moteurs Web Audio
 * séparés, et ce fichier les porte tous les deux —
 *
 * - `sfx` : application principale. Portage direct de la classe `SFX` du
 *   prototype — gain maître 0.22, bus de réverbération partagé (delay 0.21 s,
 *   feedback 0.3, passe-bas 2600 Hz, retour à 0.2), `tone()` avec attaque et
 *   glissando exponentiel, `noise()` en passe-bande. Onze cues : whisper,
 *   confirm, auto, undo, ping, listen, rec, tick, saved, stop, night.
 * - `setup` : assistant de configuration. Portage direct de la constante `SND`
 *   de `Setup.dc.html` — gain maître 0.2, sinusoïdes sèches (ni glissando, ni
 *   bus de réverbération). Cinq cues : step, tick, ok, err, done.
 *
 * Les deux moteurs partagent le même interrupteur de sourdine, exactement
 * comme le prototype qui passe `sound={{ soundOn }}` à son assistant avec
 * `soundOn = sound && !muted`.
 *
 * Les navigateurs (Electron compris) refusent de démarrer un `AudioContext`
 * sans geste de l'utilisateur : `mountSoundUnlock()` branche le déverrouillage
 * sur le premier `pointerdown`/`keydown`, `ready` reste faux jusque-là, et
 * `playSfx`/`playSetupSound` sont muets tant que le contexte n'est pas
 * `running`. C'est ce que reflète l'indication « Touchez l'écran pour activer
 * le son » reprise telle quelle dans l'en-tête de la vue journée.
 */

/** Cues de l'application principale. */
export type SfxName =
  | "whisper"
  | "confirm"
  | "auto"
  | "undo"
  | "ping"
  | "listen"
  | "rec"
  | "tick"
  | "saved"
  | "stop"
  | "night"

/** Cues de l'assistant de configuration. */
export type SetupSoundName = "step" | "tick" | "ok" | "err" | "done"

export interface SoundSnapshot {
  /** Sourdine active : aucune cue ne part, ni de l'app ni de l'assistant. */
  muted: boolean
  /** `AudioContext` déverrouillé et en train de tourner (voir `unlockSound`). */
  ready: boolean
}

interface ToneOptions {
  /** Gain du pic d'enveloppe (0.4 par défaut dans le prototype). */
  g?: number
  /** Durée de l'attaque, en secondes (0.012 par défaut). */
  a?: number
  type?: OscillatorType
  /** Fréquence d'arrivée d'un glissando exponentiel à 70 % de la durée. */
  glide?: number
  /** Part du signal envoyée au bus de réverbération (0.5 par défaut). */
  send?: number
}

function audioContextConstructor(): typeof AudioContext | undefined {
  const scope = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return scope.AudioContext ?? scope.webkitAudioContext
}

interface SfxGraph {
  ctx: AudioContext
  master: GainNode
  send: GainNode
}

/** Portage direct de la classe `SFX` du prototype. */
class SfxEngine {
  private graph: SfxGraph | null = null

  unlock(): void {
    const Constructor = audioContextConstructor()
    if (!Constructor) return
    if (!this.graph) {
      const ctx = new Constructor()
      const master = ctx.createGain()
      master.gain.value = 0.22
      master.connect(ctx.destination)

      const delay = ctx.createDelay()
      delay.delayTime.value = 0.21
      const feedback = ctx.createGain()
      feedback.gain.value = 0.3
      const lowpass = ctx.createBiquadFilter()
      lowpass.type = "lowpass"
      lowpass.frequency.value = 2600
      const wet = ctx.createGain()
      wet.gain.value = 0.2
      const send = ctx.createGain()
      send.connect(delay)
      delay.connect(lowpass)
      lowpass.connect(feedback)
      feedback.connect(delay)
      lowpass.connect(wet)
      wet.connect(ctx.destination)

      this.graph = { ctx, master, send }
    }
    if (this.graph.ctx.state === "suspended") void this.graph.ctx.resume()
  }

  ready(): boolean {
    return this.graph !== null && this.graph.ctx.state === "running"
  }

  play(name: SfxName): void {
    const graph = this.graph
    if (!graph || graph.ctx.state !== "running") return
    const t = graph.ctx.currentTime + 0.01
    switch (name) {
      case "whisper":
        this.tone(graph, 659.25, t, 1.5, { g: 0.3, a: 0.06, send: 0.7 })
        this.tone(graph, 987.77, t + 0.14, 1.8, { g: 0.2, a: 0.06, send: 0.7 })
        break
      case "confirm":
        this.tone(graph, 523.25, t, 0.35, { g: 0.32 })
        this.tone(graph, 783.99, t + 0.09, 0.7, { g: 0.28 })
        break
      case "auto":
        this.tone(graph, 1318.5, t, 0.3, { g: 0.1, send: 0.9 })
        this.noise(graph, t, 0.05, 3200, 0.05)
        break
      case "undo":
        this.tone(graph, 783.99, t, 0.3, { g: 0.24 })
        this.tone(graph, 587.33, t + 0.09, 0.5, { g: 0.22 })
        break
      case "ping":
        this.tone(graph, 1567.98, t, 1.8, { g: 0.16, send: 0.9 })
        this.tone(graph, 2349.3, t, 0.9, { g: 0.05, send: 0.9 })
        break
      case "listen":
        this.noise(graph, t, 0.4, 900, 0.06)
        this.tone(graph, 392, t, 0.4, { g: 0.06, glide: 587 })
        break
      case "rec":
        this.tone(graph, 392, t, 0.6, { g: 0.16, a: 0.03 })
        this.tone(graph, 587.33, t + 0.12, 0.9, { g: 0.14, a: 0.03 })
        break
      case "tick":
        this.noise(graph, t, 0.03, 4200, 0.035)
        this.tone(graph, 2093, t, 0.12, { g: 0.04, send: 0.3 })
        break
      case "saved":
        this.tone(graph, 1046.5, t, 0.18, { g: 0.12 })
        this.tone(graph, 1568, t + 0.06, 0.35, { g: 0.1, send: 0.7 })
        break
      case "stop":
        this.tone(graph, 587.33, t, 0.5, { g: 0.16, a: 0.02 })
        this.tone(graph, 392, t + 0.12, 0.9, { g: 0.14, a: 0.02 })
        break
      case "night":
        this.tone(graph, 783.99, t, 1.4, { g: 0.16, a: 0.05, send: 0.8 })
        this.tone(graph, 659.25, t + 0.28, 1.6, { g: 0.14, a: 0.05, send: 0.8 })
        this.tone(graph, 523.25, t + 0.56, 2.4, { g: 0.14, a: 0.05, send: 0.8 })
        break
    }
  }

  private tone(graph: SfxGraph, f: number, t0: number, dur: number, options: ToneOptions = {}): void {
    const { ctx } = graph
    const g = options.g ?? 0.4
    const a = options.a ?? 0.012
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = options.type ?? "sine"
    osc.frequency.setValueAtTime(f, t0)
    if (options.glide) osc.frequency.exponentialRampToValueAtTime(options.glide, t0 + dur * 0.7)
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(g, t0 + a)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(env)
    env.connect(graph.master)
    const send = ctx.createGain()
    send.gain.value = options.send ?? 0.5
    env.connect(send)
    send.connect(graph.send)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  private noise(graph: SfxGraph, t0: number, dur: number, f: number, g: number): void {
    const { ctx } = graph
    const length = Math.floor(ctx.sampleRate * dur)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const bandpass = ctx.createBiquadFilter()
    bandpass.type = "bandpass"
    bandpass.frequency.value = f
    bandpass.Q.value = 1.2
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(g, t0 + dur * 0.4)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    source.connect(bandpass)
    bandpass.connect(env)
    env.connect(graph.master)
    source.start(t0)
    source.stop(t0 + dur + 0.05)
  }
}

interface SetupGraph {
  ctx: AudioContext
  master: GainNode
}

/** Portage direct de la constante `SND` de `Setup.dc.html`. */
class SetupSoundEngine {
  private graph: SetupGraph | null = null

  unlock(): void {
    const Constructor = audioContextConstructor()
    if (!Constructor) return
    if (!this.graph) {
      const ctx = new Constructor()
      const master = ctx.createGain()
      master.gain.value = 0.2
      master.connect(ctx.destination)
      this.graph = { ctx, master }
    }
    if (this.graph.ctx.state === "suspended") void this.graph.ctx.resume()
  }

  ready(): boolean {
    return this.graph !== null && this.graph.ctx.state === "running"
  }

  play(name: SetupSoundName): void {
    const graph = this.graph
    if (!graph || graph.ctx.state !== "running") return
    const t = graph.ctx.currentTime + 0.01
    switch (name) {
      case "step":
        this.tone(graph, 880, t, 0.14, 0.05)
        break
      case "tick":
        this.tone(graph, 1318.5, t, 0.3, 0.12)
        break
      case "ok":
        this.tone(graph, 1046.5, t, 0.2, 0.16)
        this.tone(graph, 1568, t + 0.07, 0.5, 0.13)
        break
      case "err":
        this.tone(graph, 440, t, 0.25, 0.14)
        this.tone(graph, 349.2, t + 0.1, 0.4, 0.12)
        break
      case "done":
        for (const [index, f] of [523.25, 659.25, 783.99, 1046.5].entries()) {
          this.tone(graph, f, t + index * 0.09, 1.3, 0.11)
        }
        break
    }
  }

  private tone(graph: SetupGraph, f: number, t0: number, d: number, g: number): void {
    const { ctx } = graph
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = f
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(g, t0 + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
    osc.connect(env)
    env.connect(graph.master)
    osc.start(t0)
    osc.stop(t0 + d + 0.05)
  }
}

const sfx = new SfxEngine()
const setup = new SetupSoundEngine()

let muted = false
let snapshot: SoundSnapshot = { muted: false, ready: false }
const listeners = new Set<() => void>()

function refresh(): void {
  const ready = sfx.ready()
  if (snapshot.muted === muted && snapshot.ready === ready) return
  snapshot = { muted, ready }
  for (const listener of listeners) listener()
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Instantané stable, requis par `useSyncExternalStore` (voir `useSound`). */
export function getSoundSnapshot(): SoundSnapshot {
  return snapshot
}

/**
 * Déverrouille les deux contextes audio. À appeler sur chaque `pointerdown` et
 * `keydown` : `resume()` est asynchrone, donc le prototype laissait 60 ms avant
 * de se déclarer prêt et rappelait `unlock()` à chaque interaction — l'appel
 * suivant réessaie tant que le contexte n'est pas `running`.
 */
export function unlockSound(): void {
  sfx.unlock()
  setup.unlock()
  window.setTimeout(refresh, 60)
}

/** À monter une fois au démarrage (`main.tsx`). */
export function mountSoundUnlock(): void {
  window.addEventListener("pointerdown", unlockSound)
  window.addEventListener("keydown", unlockSound)
}

/** Cue de l'application principale. Muette pendant la sourdine, comme `sfx.play` dans le prototype. */
export function playSfx(name: SfxName): void {
  if (!muted) sfx.play(name)
}

/** Cue de l'assistant de configuration (`soundOn` du prototype). */
export function playSetupSound(name: SetupSoundName): void {
  if (!muted) setup.play(name)
}

/** Le prototype ne sonne qu'en *sortant* de sourdine, jamais en y entrant. */
export function toggleMute(): void {
  unlockSound()
  muted = !muted
  refresh()
  if (!muted) window.setTimeout(() => sfx.play("confirm"), 80)
}
