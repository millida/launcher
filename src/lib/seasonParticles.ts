import type { ParticleStyle, Season } from './ambience'

/// Seasonal particles on a low-resolution canvas (one canvas pixel = several screen pixels, drawn pixelated):
/// falling snow or pumpkins, snow drifts that pile up along the bottom edge, firework bursts.
/// Shared by the lobby layer and the window-wide festive layer, so both fall the same way.

export interface Flake {
  x: number
  y: number
  size: number
  speed: number
  phase: number
  color: string
}

export interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

export interface SceneOptions {
  /** Screen pixels per canvas pixel. */
  pixel: number
  /** Tallest snow drift in canvas pixels; 0 — no drifts. */
  drift?: number
  /** Firework spark size in canvas pixels (the lobby keeps 1). */
  spark?: number
}

export interface Scene {
  w: number
  h: number
  pixel: number
  spark: number
  flakes: Flake[]
  sparks: Spark[]
  nextBurst: number
  /** Snow lying along the bottom edge: height per column, in canvas pixels. */
  ground: Float32Array | null
  /** How tall each column may grow: low hills rather than a flat shelf. */
  cap: Float32Array | null
}

const SPARKS_PER_BURST = 28
/** A drift starts half grown, so the theme looks wintry from the first minute. */
const DRIFT_START = 0.5
/** How much of a landed flake stays on the drift, per canvas pixel of its size. */
const DRIFT_GAIN = 0.45
const DRIFT_TOP = '#ffffff'
const DRIFT_BODY = '#dce8f6'

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)] ?? list[0]!

function makeFlake(style: ParticleStyle, w: number, h: number, pixel: number, top = false): Flake {
  return {
    x: rand(0, w),
    y: top ? -rand(0, h * 0.2) : rand(0, h),
    size: Math.round(rand(style.size[0], style.size[1]) / pixel) || 1,
    speed: rand(style.fall[0], style.fall[1]) / pixel,
    phase: rand(0, Math.PI * 2),
    color: pick(style.colors),
  }
}

function makeGround(w: number, max: number): { ground: Float32Array; cap: Float32Array } {
  const ground = new Float32Array(w)
  const cap = new Float32Array(w)
  const a = rand(0, Math.PI * 2)
  const b = rand(0, Math.PI * 2)
  for (let x = 0; x < w; x++) {
    const hill = 0.62 + 0.24 * Math.sin(x / 37 + a) + 0.14 * Math.sin(x / 13 + b)
    cap[x] = Math.max(2, max * hill)
    ground[x] = cap[x]! * DRIFT_START
  }
  return { ground, cap }
}

export function makeScene(style: ParticleStyle, w: number, h: number, opts: SceneOptions): Scene {
  const drift = opts.drift ?? 0
  const g = drift > 0 ? makeGround(w, drift) : null
  return {
    w,
    h,
    pixel: opts.pixel,
    spark: opts.spark ?? 1,
    flakes: Array.from({ length: style.count }, () => makeFlake(style, w, h, opts.pixel)),
    sparks: [],
    nextBurst: 0,
    ground: g?.ground ?? null,
    cap: g?.cap ?? null,
  }
}

function burst(scene: Scene, style: ParticleStyle) {
  const x = rand(scene.w * 0.15, scene.w * 0.85)
  const y = rand(scene.h * 0.1, scene.h * 0.45)
  const color = pick(style.sparks)
  for (let i = 0; i < SPARKS_PER_BURST; i++) {
    const a = (i / SPARKS_PER_BURST) * Math.PI * 2
    const v = rand(14, 30)
    scene.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color })
  }
}

/** A landed flake adds to the drift under it; the slope then settles so no column stands alone. */
function land(scene: Scene, f: Flake) {
  const { ground, cap } = scene
  if (!ground || !cap) return
  const from = Math.max(0, Math.floor(f.x))
  const to = Math.min(scene.w - 1, from + f.size - 1)
  for (let x = from; x <= to; x++) ground[x] = Math.min(cap[x]!, ground[x]! + DRIFT_GAIN)
}

function settle(ground: Float32Array) {
  for (let x = 1; x < ground.length; x++) {
    const d = ground[x]! - ground[x - 1]!
    if (d > 2 || d < -2) {
      const step = d > 0 ? 0.5 : -0.5
      ground[x] = ground[x]! - step
      ground[x - 1] = ground[x - 1]! + step
    }
  }
}

/** Advance the scene by `dt` seconds at clock time `t` (ms). */
export function stepScene(scene: Scene, style: ParticleStyle, dt: number, t: number) {
  const { w, h, ground } = scene
  for (const f of scene.flakes) {
    f.y += f.speed * dt
    f.x += Math.sin(t / 1000 + f.phase) * style.drift * dt * 0.2
    const col = Math.min(w - 1, Math.max(0, Math.floor(f.x)))
    const floor = ground ? h - (ground[col] ?? 0) : h
    if (f.y + f.size >= floor) {
      if (ground && f.y < h) land(scene, f)
      Object.assign(f, makeFlake(style, w, h, scene.pixel, true))
    }
  }
  if (ground) settle(ground)
  if (style.sparks.length) {
    if (t > scene.nextBurst) {
      burst(scene, style)
      scene.nextBurst = t + rand(900, 1800)
    }
    for (let i = scene.sparks.length - 1; i >= 0; i--) {
      const s = scene.sparks[i]!
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 12 * dt
      s.life -= dt * 0.7
      if (s.life <= 0) scene.sparks.splice(i, 1)
    }
  }
}

export function drawScene(g: CanvasRenderingContext2D, scene: Scene, style: ParticleStyle, season: Season) {
  const { w, h, ground } = scene
  g.clearRect(0, 0, w, h)
  for (const f of scene.flakes) {
    g.fillStyle = f.color
    g.fillRect(Math.round(f.x), Math.round(f.y), f.size, f.size)
    if (season === 'halloween' && f.size > 1) {
      g.fillStyle = style.colors[2] ?? f.color
      g.fillRect(Math.round(f.x + f.size / 2), Math.round(f.y) - 1, 1, 1)
    }
  }
  if (ground) {
    g.fillStyle = DRIFT_BODY
    for (let x = 0; x < w; x++) {
      const top = Math.floor(ground[x]!)
      if (top > 1) g.fillRect(x, h - top + 1, 1, top - 1)
    }
    g.fillStyle = DRIFT_TOP
    for (let x = 0; x < w; x++) {
      const top = Math.floor(ground[x]!)
      if (top > 0) g.fillRect(x, h - top, 1, 1)
    }
  }
  for (const s of scene.sparks) {
    g.globalAlpha = Math.max(0, s.life)
    g.fillStyle = s.color
    g.fillRect(Math.round(s.x), Math.round(s.y), scene.spark, scene.spark)
  }
  g.globalAlpha = 1
}
