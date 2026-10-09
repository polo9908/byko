/**
 * Goutte d'eau « verre liquide » de la frise (portée depuis le prototype d'étude de mouvement).
 *
 * Rendu WebGL dans un canvas posé sur la frise, transparent hors de la goutte et traversé par
 * le pointeur. La goutte est un champ de distance : un corps, une gouttelette et un satellite
 * unis en douceur — entre deux masses qui s'écartent se forme un cou qui s'amincit puis se
 * rompt, comme un vrai liquide. Elle réfracte une copie de la frise repeinte d'après le DOM
 * (texte net) : grossissement au centre, bord qui ramasse le contenu d'au-delà, dispersion
 * chromatique (liseré irisé), reflets, anneau sombre, ombre portée.
 *
 * Physique : à l'approche d'un jalon la goutte naît, éclot en rebondissant et tremble ; au
 * départ elle s'étire vers le curseur, se pince, lâche une gouttelette qui file et s'évapore,
 * et le reste se rétracte en tremblant avant de sécher.
 *
 * Les jalons sont ceux de la frise (Google Agenda réel, ou repli) : leur position est lue sur
 * les boutons `.dayview-timeline-milestone` (même ordre), leurs horaires servent à la ligne
 * d'info (« Dans 2 h 10 », « En cours · reste 12 min »…) qui n'existe que dans la goutte.
 */

import { prefersReducedMotion } from "./motion"

export interface DropMilestone {
  startMinutes: number
  endMinutes?: number
}

/** Moments sonores de la goutte : elle naît, saute d'un jalon à l'autre, lâche sa gouttelette. */
export type DropSound = "birth" | "move" | "split"

export interface WaterDrop {
  /** En pause (une fenêtre modale est ouverte) : la goutte se retire, ignore souris et clavier, et reste muette. */
  setPaused(paused: boolean): void
  setMilestones(milestones: DropMilestone[]): void
  destroy(): void
}

const HX = 37
const R = 41
const ANCHOR_Y = 50
const ZOOM = 0.32
const MAGNET = 96
const REACH = 150
const K = 22
const KC = 5
const PAD_TOP = 90
const CANVAS_H = 260
const B_MIN_Y = -40
const B_MAX_Y = 95

const VS = "attribute vec2 aP; void main(){ gl_Position=vec4(aP,0.,1.); }"
const FS = [
  "precision highp float;",
  "uniform vec2 uRes, uSize; uniform float uDpr, uTime, uK, uKC, uMagA, uMagB, uReveal;",
  "uniform sampler2D uTex, uMeta;",
  "uniform vec4 uA; uniform vec2 uAS;",
  "uniform vec4 uB; uniform vec3 uBv;",
  "uniform vec3 uC;",
  "uniform vec3 uT, uSh;",
  "float smin(float a,float b,float k){ float h=max(k-abs(a-b),0.)/k; return min(a,b)-h*h*k*.25; }",
  "float sdA(vec2 p){ if(uA.w<.4) return 1e4; vec2 q=(p-uA.xy)/uAS; q.x=max(abs(q.x)-uA.z,0.); return (length(q)-uA.w)*min(uAS.x,uAS.y); }",
  // Larme : nez arrondi devant, traîne effilée derrière, d'autant plus qu'elle file vite.
  "float sdB(vec2 p){ if(uB.z<.4) return 1e4; vec2 q=p-uB.xy; vec2 n=vec2(-uBv.y,uBv.x); float a=dot(q,uBv.xy), b=dot(q,n), s=uBv.z;",
  "  float sa=a<0.?1.+s*1.9:1.+s*.35, sb=1.+s*.3; vec2 e=vec2(a/sa,b*sb); float L=length(e);",
  "  vec2 gr=vec2(e.x/sa,e.y*sb)/max(L,1e-4); return (L-uB.z)/max(length(gr),.2); }",
  "float sdC(vec2 p){ if(uC.z<.3) return 1e4; return length(p-uC.xy)-uC.z; }",
  "float field(vec2 p){ return smin(smin(sdA(p),sdB(p),uK),sdC(p),uKC); }",
  "vec3 under(vec2 p){ vec2 uv=clamp(p/uSize,0.,1.); vec3 c=texture2D(uTex,uv).rgb; vec4 m=texture2D(uMeta,uv); return mix(c,m.rgb,m.a*uReveal); }",
  "void main(){",
  "  vec2 pos=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;",
  "  float dA=sdA(pos), dB=sdB(pos), dC=sdC(pos), d=smin(smin(dA,dB,uK),dC,uKC);",
  "  if(d>28.){ gl_FragColor=vec4(0.); return; }",
  // Ombre portée (lumière en haut à gauche), proportionnée à chaque masse, + ombre de contact.
  "  vec2 sp=pos-vec2(3.,7.);",
  "  float sh=.11*max(max((1.-smoothstep(-6.,18.,sdA(sp)))*uSh.x,(1.-smoothstep(-5.,14.,sdB(sp)))*uSh.y),(1.-smoothstep(-2.,6.,sdC(sp)))*uSh.z)",
  "          +.09*(1.-smoothstep(0.,3.5,d));",
  "  float aa=clamp(.5-d*uDpr,0.,1.);",
  "  vec3 shC=vec3(.22,.16,.10);",
  "  if(aa<=0.){ gl_FragColor=vec4(shC*sh,sh); return; }",
  "  float e=.75; vec2 g=vec2(field(pos+vec2(e,0.))-field(pos-vec2(e,0.)),field(pos+vec2(0.,e))-field(pos-vec2(0.,e)));",
  "  float gn=length(g); g=gn>1e-5?g/gn:vec2(0.);",
  // Grossissement autour du centre de chaque masse (nul dans le cou).
  "  float wA=1./(1.+exp(dA/5.)), wB=1./(1.+exp(dB/5.)), wC=1./(1.+exp(dC/3.)), ws=max(1.,wA+wB);",
  // Bord proportionné à la masse : une petite goutte reste claire au cœur.
  "  float T=max(1.5,(uT.x*wA+uT.y*wB+uT.z*wC)/max(wA+wB+wC,1e-3));",
  "  float ef=1.-clamp(-d/T,0.,1.);",
  "  float bend=ef*ef*(3.-2.*ef)*ef;",
  "  vec2 mag=((uA.xy-pos)*(1.-1./uMagA)*wA+(uB.xy-pos)*(1.-1./uMagB)*wB)/ws;",
  // Le bord va chercher le contenu au-delà ; chaque couleur est déviée un peu différemment.
  "  vec2 edge=g*bend*min(13.,T*.85);",
  "  vec3 col=vec3(under(pos+mag*1.0+edge*.86).r, under(pos+mag*1.004+edge).g, under(pos+mag*1.008+edge*1.17).b);",
  "  col+=.008;",
  // Anneau sombre sous le bord : la lumière y est déviée hors de l'œil, signature d'une vraie goutte.
  "  float ring=smoothstep(.45,.75,ef)*(1.-smoothstep(.9,1.,ef)); col*=1.-.15*ring;",
  // Liseré irisé, plus marqué sur les flancs.
  "  float ang=atan(g.y,g.x);",
  "  vec3 irid=.5+.5*cos(6.2832*(ang*.159+uTime*.05+ef*.7+vec3(0.,.33,.67)));",
  "  float rim=smoothstep(.74,1.,ef)*(.45+.55*abs(g.x));",
  "  col=mix(col,col*.5+irid*.62,rim*.42);",
  // Volume : dôme, fresnel, deux reflets, caustique au fond.
  "  vec3 N=normalize(vec3(g*bend*2.4,1.));",
  "  vec3 H1=normalize(normalize(vec3(-.45,-.75,.8))+vec3(0.,0.,1.));",
  "  vec3 H2=normalize(normalize(vec3(.5,.8,.6))+vec3(0.,0.,1.));",
  "  col=mix(col,vec3(1.),pow(ef,6.)*.08);",
  "  col+=pow(max(dot(N,H1),0.),80.)*1.0+pow(max(dot(N,H2),0.),48.)*.16;",
  "  col+=smoothstep(.15,.55,ef)*(1.-smoothstep(.55,.85,ef))*max(dot(g,vec2(.45,.8)),0.)*.07;",
  "  gl_FragColor=vec4(clamp(col,0.,1.)*aa+shC*sh*(1.-aa),aa+sh*(1.-aa));",
  "}",
].join("\n")

const UNIFORMS = [
  "uRes",
  "uSize",
  "uDpr",
  "uTime",
  "uK",
  "uKC",
  "uMagA",
  "uMagB",
  "uReveal",
  "uTex",
  "uMeta",
  "uA",
  "uAS",
  "uB",
  "uBv",
  "uC",
  "uT",
  "uSh",
] as const
type UniformName = (typeof UNIFORMS)[number]

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (t: number): number => t * t * (3 - 2 * t)
const pad = (n: number): string => String(n).padStart(2, "0")

function duration(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return `${h} h${r ? ` ${pad(r)}` : ""}`
}

/** Ligne d'info d'un jalon, en segments (le gras est mis en couleur d'accent). La durée se lit déjà dans la plage. */
function metaFor(m: DropMilestone): { text: string; strong?: boolean }[] {
  const d = new Date()
  const now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  if (m.endMinutes !== undefined && now >= m.startMinutes && now < m.endMinutes) {
    return [{ text: "En cours", strong: true }, { text: ` · reste ${duration(m.endMinutes - now)}` }]
  }
  if (now < m.startMinutes) {
    return m.startMinutes - now < 5
      ? [{ text: "Maintenant", strong: true }]
      : [{ text: `Dans ${duration(m.startMinutes - now)}` }]
  }
  return [{ text: `Il y a ${duration(now - (m.endMinutes ?? m.startMinutes))}` }]
}

function opaqueBackground(el: HTMLElement): string {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg
  }
  return getComputedStyle(document.body).backgroundColor
}

/**
 * Crée la goutte sur la frise `timeline`, rendue dans `canvas` (enfant de la frise). Renvoie
 * `null` sans WebGL : la frise reste alors telle quelle. Respecte « réduire les animations ».
 */
export function createWaterDrop(
  timeline: HTMLElement,
  canvas: HTMLCanvasElement,
  onSound?: (event: DropSound) => void,
): WaterDrop | null {
  const glContext = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
  })
  if (!glContext) return null
  const gl: WebGLRenderingContext = glContext
  const reduce = prefersReducedMotion()

  function compile(type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[goutte]", gl.getShaderInfoLog(shader))
      return null
    }
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, VS)
  const fs = compile(gl.FRAGMENT_SHADER, FS)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[goutte]", gl.getProgramInfoLog(program))
    return null
  }
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const aP = gl.getAttribLocation(program, "aP")
  gl.enableVertexAttribArray(aP)
  gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0)
  const U = {} as Record<UniformName, WebGLUniformLocation | null>
  for (const name of UNIFORMS) U[name] = gl.getUniformLocation(program, name)

  function makeTexture(unit: number): WebGLTexture | null {
    const texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }
  const texBase = makeTexture(0)
  const texMeta = makeTexture(1)
  gl.uniform1i(U.uTex, 0)
  gl.uniform1i(U.uMeta, 1)

  /* ---- Ce que la goutte réfracte : la frise, repeinte d'après le DOM ---- */
  const baseCanvas = document.createElement("canvas")
  const metaCanvas = document.createElement("canvas")
  let milestones: DropMilestone[] = []
  let cssW = 0
  let offX = 0
  let texScale = 2
  let painted = ""
  let destroyed = false

  const buttons = (): HTMLElement[] => Array.from(timeline.querySelectorAll<HTMLElement>(".dayview-timeline-milestone"))
  const fillEl = (): HTMLElement | null => timeline.querySelector<HTMLElement>(".dayview-timeline-fill")
  const nowEl = (): HTMLElement | null => timeline.querySelector<HTMLElement>(".dayview-timeline-now")
  const signature = (): string =>
    `${fillEl()?.style.width ?? ""}|${nowEl()?.style.left ?? ""}|${milestones.length}|${timeline.getBoundingClientRect().width}`

  function layout(): void {
    const tr = timeline.getBoundingClientRect()
    cssW = document.documentElement.clientWidth
    offX = tr.left
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    texScale = Math.min(4, dpr * 1.6)
    canvas.style.left = `${-offX}px`
    canvas.style.top = `${-PAD_TOP}px`
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${CANVAS_H}px`
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(CANVAS_H * dpr)
    gl.viewport(0, 0, canvas.width, canvas.height)
    paint()
  }

  function paint(): void {
    const cr = canvas.getBoundingClientRect()
    const S = texScale
    baseCanvas.width = metaCanvas.width = Math.round(cssW * S)
    baseCanvas.height = metaCanvas.height = Math.round(CANVAS_H * S)
    const g = baseCanvas.getContext("2d")
    const mg = metaCanvas.getContext("2d")
    if (!g || !mg) return
    g.setTransform(S, 0, 0, S, 0, 0)
    g.fillStyle = opaqueBackground(timeline)
    g.fillRect(0, 0, cssW, CANVAS_H)
    const shapes = timeline.querySelectorAll<HTMLElement>(
      ".dayview-timeline-track, .dayview-timeline-fill, .dayview-timeline-now, .dayview-timeline-tick, .dayview-timeline-block",
    )
    shapes.forEach((el) => {
      const cs = getComputedStyle(el)
      if (cs.display === "none") return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      g.globalAlpha = parseFloat(cs.opacity) || 1
      g.fillStyle = cs.backgroundColor
      const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
      g.beginPath()
      g.roundRect(r.left - cr.left, r.top - cr.top, r.width, r.height, radius)
      g.fill()
    })
    timeline.querySelectorAll<HTMLElement>(".dayview-timeline-label, .dayview-timeline-time").forEach((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const text = el.textContent ?? ""
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      g.globalAlpha = parseFloat(cs.opacity) || 1
      g.fillStyle = cs.color
      g.textBaseline = "alphabetic"
      const m = g.measureText(text)
      const asc = m.fontBoundingBoxAscent
      const desc = m.fontBoundingBoxDescent
      g.fillText(text, r.left - cr.left, r.top - cr.top + (r.height - (asc + desc)) / 2 + asc)
    })
    // Ligne d'info : n'existe que dans la goutte (elle apparaît en grossissant).
    mg.setTransform(S, 0, 0, S, 0, 0)
    mg.clearRect(0, 0, cssW, CANVAS_H)
    const root = getComputedStyle(document.documentElement)
    const family = getComputedStyle(timeline).fontFamily
    const muted = root.getPropertyValue("--bcc-color-text-muted").trim()
    const accent = root.getPropertyValue("--bcc-color-accent").trim()
    buttons().forEach((button, i) => {
      const milestone = milestones[i]
      const time = button.querySelector(".dayview-timeline-time")
      if (!milestone || !time) return
      const tr = time.getBoundingClientRect()
      const br = button.getBoundingClientRect()
      const segments = metaFor(milestone).map((s) => {
        mg.font = `${s.strong ? 600 : 500} 9px ${family}`
        return { ...s, width: mg.measureText(s.text).width }
      })
      let x = br.left + br.width / 2 - cr.left - segments.reduce((w, s) => w + s.width, 0) / 2
      const y = tr.bottom - cr.top + 10
      for (const s of segments) {
        mg.font = `${s.strong ? 600 : 500} 9px ${family}`
        mg.fillStyle = s.strong ? accent : muted
        mg.fillText(s.text, x, y)
        x += s.width
      }
    })
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texBase)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, baseCanvas)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, texMeta)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, metaCanvas)
    painted = signature()
  }

  /* ---- Physique ---- */
  const KX = 430,
    CX = 24 // position (ζ≈0,58) : l'aimant dépasse puis revient
  const KP = 260,
    CP = 14.5 // présence à l'arrivée (ζ≈0,45) : éclot en rebondissant
  const KP_OUT = 70,
    CP_OUT = 15 // présence au départ (ζ≈0,9) : laisse à l'eau le temps de s'étirer
  const KD = 320,
    CD = 9 // gelée (ζ≈0,25) : tremble plusieurs fois avant de se poser
  const KB = 300,
    CB = 22 // gouttelette tirée par le curseur
  const st = {
    x: 0,
    vx: 0,
    tx: 0,
    p: 0,
    vp: 0,
    tp: 0,
    d: 0,
    vd: 0,
    hot: -1,
    anchor: -1,
    leaving: false,
    ux: 1,
    uy: 0,
    dux: 1,
    duy: 0,
    running: false,
    last: 0,
    t0: performance.now(),
    drawn: false,
    resid: 0,
  }
  const B = { on: false, att: false, x: 0, y: 0, vx: 0, vy: 0, r: 0 } // gouttelette
  const C = { on: false, x: 0, y: 0, vx: 0, vy: 0, r: 0 } // satellite né au pincement
  let xs: number[] = []
  let client: { x: number; y: number } | null = null
  let keyFocus = -1
  let raf = 0
  let paused = false
  let lastSoundAt = 0
  let lastHot = -1
  const emit = (event: DropSound): void => {
    const now = performance.now()
    if (!onSound || paused || now - lastSoundAt < 90) return
    lastSoundAt = now
    onSound(event)
  }

  const sizeOf = (p: number): number => (p <= 0 ? 0 : (0.3 + 0.7 * p) * smooth(clamp01(p / 0.25)))
  function shapeA(): { r: number; hx: number; sx: number; sy: number } {
    const s = Math.max(sizeOf(st.p), st.resid)
    return {
      r: R * s,
      hx: HX * s * smooth(clamp01((s - 0.3) / 0.5)),
      sx: 1 + st.d,
      sy: 1 - st.d * 0.75,
    }
  }
  const extentA = (a: ReturnType<typeof shapeA>, ux: number, uy: number): number =>
    Math.abs(ux) * (a.hx + a.r) * a.sx + Math.abs(uy) * a.r * a.sy

  function updateLeaving(): void {
    if (!st.leaving && st.hot >= 0 && st.tp < st.p - 0.03) {
      st.leaving = true
      st.anchor = st.hot
      if (!reduce) Object.assign(B, { on: true, att: true, x: st.x, y: ANCHOR_Y, vx: 0, vy: 0, r: 0 })
    } else if (st.leaving && st.tp > st.p + 0.03) {
      st.leaving = false
    }
  }

  function aim(): void {
    if (destroyed) return
    const rect = timeline.getBoundingClientRect()
    if (Math.abs(rect.left - offX) > 0.5) layout()
    xs = buttons().map((b) => b.offsetLeft)
    const minX = -rect.left + 12 + HX + R
    const maxX = document.documentElement.clientWidth - rect.left - 12 - HX - R
    const clampX = (v: number): number => Math.max(minX, Math.min(maxX, v))
    let best = -1
    let lx: number | null = null
    let ly = 0
    if (xs.length === 0) {
      st.tp = 0
    } else if (keyFocus >= 0 && keyFocus < xs.length) {
      best = keyFocus
      st.tx = xs[best]
      st.tp = 1
    } else if (!client) {
      st.tp = 0
    } else {
      lx = client.x - rect.left
      ly = client.y - rect.top
      let bestD = Infinity
      xs.forEach((x, i) => {
        const dd = Math.abs((lx ?? 0) - x)
        if (dd < bestD) {
          bestD = dd
          best = i
        }
      })
      const band = 1 - smooth(clamp01((Math.abs(ly - ANCHOR_Y) - 46) / 44)) // pleine autour des jalons, s'éteint au-delà
      const pull = smooth(clamp01(1 - bestD / MAGNET))
      st.tx = lx + (xs[best] - lx) * pull * 0.9
      st.tp = band * smooth(clamp01(1 - (bestD - 8) / REACH))
    }
    st.tx = clampX(st.tx)
    if (!st.leaving) st.hot = best
    updateLeaving()
    // Elle saute d'un jalon à l'autre : un petit « plic » (pas pendant sa naissance ni son départ).
    if (!st.leaving && st.hot >= 0 && st.hot !== lastHot && st.p > 0.35) emit("move")
    lastHot = st.leaving || st.tp <= 0 ? -1 : st.hot
    if (st.leaving && st.anchor >= 0 && st.anchor < xs.length) {
      st.hot = st.anchor
      st.tx = clampX(xs[st.anchor]) // accrochée à son jalon : c'est l'eau qui part
      if (lx !== null) {
        const vx = lx - st.x
        const vy = (ly - ANCHOR_Y) * 0.55 // vertical atténué : un départ latéral reste à plat
        const len = Math.hypot(vx, vy)
        if (len > 1) {
          st.dux = vx / len
          st.duy = vy / len
        }
      }
    }
    // Éteinte : elle renaît là où l'on arrive, sans traverser la frise.
    if (st.p < 0.02 && st.tp > 0 && !st.leaving && !st.resid) {
      emit("birth")
      st.x = st.tx
      st.vx = 0
      st.d = st.vd = 0
      paint()
    }
    if (reduce) {
      st.x = st.tx
      st.p = st.tp
      st.vx = st.vp = 0
      B.on = C.on = false
      draw()
      return
    }
    if (!st.running) {
      st.running = true
      st.last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  }

  function frame(t: number): void {
    if (destroyed) return
    const dt = Math.min(0.032, (t - st.last) / 1000) || 0.016
    st.last = t
    updateLeaving()
    const kp = st.leaving ? KP_OUT : KP
    const cp = st.leaving ? CP_OUT : CP
    const h = dt / 2
    for (let k = 0; k < 2; k++) {
      st.vx += (-KX * (st.x - st.tx) - CX * st.vx) * h
      st.x += st.vx * h
      st.vp += (-kp * (st.p - st.tp) - cp * st.vp) * h
      st.p += st.vp * h
      // Gelée : s'étale en naissant et en filant, tremble quand l'élan retombe.
      const dT = Math.max(-0.24, Math.min(0.28, Math.abs(st.vx) / 2200 + (st.leaving ? 0 : st.vp * 0.07)))
      st.vd += (-KD * (st.d - dT) - CD * st.vd) * h
      st.d += st.vd * h
    }
    const lerp = Math.min(1, dt * 14)
    st.ux += (st.dux - st.ux) * lerp
    st.uy += (st.duy - st.uy) * lerp
    const ul = Math.hypot(st.ux, st.uy) || 1
    st.ux /= ul
    st.uy /= ul

    const a = shapeA()
    if (B.on && B.att) {
      if (st.leaving) {
        // Étirement : la gouttelette sort du bord côté curseur ; la masse passe du corps à elle.
        const pl = smooth(clamp01((1 - st.p) * 1.25))
        const ext = extentA(a, st.ux, st.uy)
        const dist = pl * (ext + R * 1.3)
        const by = Math.max(B_MIN_Y, Math.min(B_MAX_Y, ANCHOR_Y + st.uy * dist))
        for (let k = 0; k < 2; k++) {
          B.vx += (-KB * (B.x - (st.x + st.ux * dist)) - CB * B.vx) * h
          B.x += B.vx * h
          B.vy += (-KB * (B.y - by) - CB * B.vy) * h
          B.y += B.vy * h
        }
        B.r = R * (0.2 + 0.35 * pl)
        const gap = Math.hypot(B.x - st.x, B.y - ANCHOR_Y) - ext - B.r
        if (gap > K * 0.85 || st.p < 0.12) {
          // Pincement : le cou cède, la gouttelette est lancée, un satellite naît, le corps recule et tremble.
          B.att = false
          emit("split")
          B.vx += st.ux * 240
          B.vy += st.uy * 240
          const mid = ext + Math.max(0, gap) * 0.5
          Object.assign(C, {
            on: true,
            x: st.x + st.ux * mid,
            y: ANCHOR_Y + st.uy * mid,
            vx: st.ux * 90,
            vy: st.uy * 90,
            r: Math.max(2.2, B.r * 0.2),
          })
          st.vx -= st.ux * 170
          st.vd += 3.2
          st.resid = Math.min(0.42, sizeOf(st.p)) // le reste se rassemble en gouttelette ronde, puis sèche
        }
      } else {
        // On revient avant la rupture : l'eau rentre dans le corps.
        const f = Math.min(1, dt * 12)
        B.x += (st.x - B.x) * f
        B.y += (ANCHOR_Y - B.y) * f
        B.r += -B.r * Math.min(1, dt * 10)
        if (B.r < 0.5) B.on = false
      }
    } else if (B.on) {
      // Gouttelette libre : glisse en ralentissant, s'effile en larme, s'évapore.
      const fr = Math.exp(-3.2 * dt)
      B.vx *= fr
      B.vy *= fr
      B.x += B.vx * dt
      B.y += B.vy * dt
      if (B.y < B_MIN_Y || B.y > B_MAX_Y) {
        B.y = Math.max(B_MIN_Y, Math.min(B_MAX_Y, B.y))
        B.vy *= -0.25
      }
      B.r -= dt * (B.r * 1.5 + 5)
      if (B.r < 0.5) B.on = false
    }
    if (st.resid > 0) {
      st.resid -= dt * (st.resid * 1.6 + 0.12)
      if (st.resid < 0.012) st.resid = 0
    }
    if (C.on) {
      const fc = Math.exp(-5 * dt)
      C.vx *= fc
      C.vy *= fc
      C.x += C.vx * dt
      C.y += C.vy * dt
      C.r -= dt * (C.r * 2 + 2.5)
      if (C.r < 0.3) C.on = false
    }

    if (st.p > 0.6 && painted !== signature()) paint()
    draw()
    const calm =
      Math.abs(st.vx) < 0.5 &&
      Math.abs(st.x - st.tx) < 0.05 &&
      Math.abs(st.vp) < 0.002 &&
      Math.abs(st.p - st.tp) < 0.001 &&
      Math.abs(st.d) < 0.0015 &&
      Math.abs(st.vd) < 0.01 &&
      !C.on &&
      !st.resid &&
      (!B.on || (B.att && st.leaving && Math.abs(B.vx) + Math.abs(B.vy) < 0.5))
    if (calm) {
      st.x = st.tx
      st.p = st.tp
      st.vx = st.vp = st.d = st.vd = 0
      st.running = false
      draw()
      return
    }
    raf = requestAnimationFrame(frame)
  }

  function draw(): void {
    const a = shapeA()
    if (!(a.r > 0.4 || B.on || C.on)) {
      if (st.drawn) {
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        st.drawn = false
      }
      return
    }
    const p = Math.max(0, st.p)
    gl.uniform2f(U.uRes, canvas.width, canvas.height)
    gl.uniform2f(U.uSize, cssW, CANVAS_H)
    gl.uniform1f(U.uDpr, canvas.width / cssW)
    gl.uniform1f(U.uTime, (performance.now() - st.t0) / 1000)
    gl.uniform1f(U.uK, K)
    gl.uniform1f(U.uKC, KC)
    gl.uniform1f(U.uMagA, 1 + ZOOM * Math.min(1.2, p))
    gl.uniform1f(U.uMagB, 1.22)
    gl.uniform1f(U.uReveal, clamp01((p - 0.55) / 0.4))
    gl.uniform4f(U.uA, st.x + offX, ANCHOR_Y + PAD_TOP, a.hx, a.r)
    gl.uniform2f(U.uAS, reduce ? 1 : a.sx, reduce ? 1 : a.sy)
    const sp = Math.hypot(B.vx, B.vy)
    const dx = sp > 1 ? B.vx / sp : st.ux
    const dy = sp > 1 ? B.vy / sp : st.uy
    gl.uniform4f(U.uB, B.x + offX, B.y + PAD_TOP, B.on ? B.r : 0, 0)
    gl.uniform3f(U.uBv, dx, dy, B.att ? 0 : Math.min(0.9, sp / 420))
    gl.uniform3f(U.uC, C.x + offX, C.y + PAD_TOP, C.on ? C.r : 0)
    gl.uniform3f(
      U.uT,
      Math.min(16, Math.max(2, a.r * 0.42)),
      Math.min(16, Math.max(2, B.r * 0.55)),
      Math.max(1.5, C.r * 0.6),
    )
    gl.uniform3f(U.uSh, clamp01(a.r / 25), B.on ? clamp01(B.r / 25) : 0, C.on ? clamp01(C.r / 10) * 0.6 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    st.drawn = true
  }

  /* ---- Écoutes ---- */
  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || paused) return
    client = { x: event.clientX, y: event.clientY }
    aim()
  }
  const onLeave = (): void => {
    client = null
    aim()
  }
  const onScroll = (): void => {
    if (client || st.p > 0) aim()
  }
  const onResize = (): void => {
    layout()
    if (st.p > 0) aim()
  }
  // Clavier : la goutte se pose sur le jalon qui a le focus (focus visible seulement).
  const onFocusIn = (event: FocusEvent): void => {
    const button = (event.target as Element | null)?.closest<HTMLElement>(".dayview-timeline-milestone")
    if (paused || !button || !button.matches(":focus-visible")) return
    keyFocus = buttons().indexOf(button)
    aim()
  }
  const onFocusOut = (): void => {
    if (keyFocus < 0) return
    keyFocus = -1
    aim()
  }
  document.addEventListener("pointermove", onMove, { passive: true })
  document.documentElement.addEventListener("pointerleave", onLeave)
  window.addEventListener("blur", onLeave)
  window.addEventListener("scroll", onScroll, { passive: true, capture: true })
  window.addEventListener("resize", onResize)
  timeline.addEventListener("focusin", onFocusIn)
  timeline.addEventListener("focusout", onFocusOut)
  // Les polices peuvent arriver après le premier rendu : la copie de la frise doit les utiliser.
  void document.fonts?.ready.then(() => {
    if (!destroyed) paint()
  })
  layout()

  return {
    setPaused(next: boolean): void {
      if (paused === next) return
      paused = next
      if (destroyed) return
      if (next) {
        // L'eau se retire sans bruit : plus de curseur, plus de focus clavier.
        client = null
        keyFocus = -1
        aim()
      }
    },
    setMilestones(next: DropMilestone[]): void {
      milestones = next
      if (destroyed) return
      paint()
      if (st.p > 0 || client) aim()
    },
    destroy(): void {
      destroyed = true
      cancelAnimationFrame(raf)
      document.removeEventListener("pointermove", onMove)
      document.documentElement.removeEventListener("pointerleave", onLeave)
      window.removeEventListener("blur", onLeave)
      window.removeEventListener("scroll", onScroll, { capture: true })
      window.removeEventListener("resize", onResize)
      timeline.removeEventListener("focusin", onFocusIn)
      timeline.removeEventListener("focusout", onFocusOut)
      // Pas de `loseContext()` : en mode strict de React, le même canvas sert aussitôt à une nouvelle goutte.
      if (st.drawn) {
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
    },
  }
}
