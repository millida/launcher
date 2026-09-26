import { useEffect, useRef } from 'react'
import { ACCENT_EVENT, accentBase, shade } from '../../lib/accent'
import { currentDeviceTier, maxCanvasPixelRatio } from '../../lib/deviceTier'
import { onRenderGate, renderLive } from '../../lib/renderGate'
import { gpuLite } from '../../lib/gpuLite'
import { VIEW_PREFS_EVENT, bgAnimOn } from '../../state/viewPrefs'
import { WORLD_SRC, makePal, paintScene, paintVignette, stageGrid } from './stageArt'
import type { Pal } from './stageArt'

/**
 * Живой фон лобби «Сцена»: резкий шейдерный кадр Minecraft-мира и слои рецепта
 * лобби Brawl Stars поверх — цветокор под кнопки, склон в тени, свет за
 * героем, пятно света у ног, виньетка (ресёрч:
 * analysis/2026-09-23_lobby-background-research.md, …-lobby-stage-research.md
 * и …-brawl.md).
 *
 * Слои снизу вверх:
 *  1. статичная сцена (stageArt.paintScene) — рисуется один раз на размер
 *     и цвет кнопок;
 *  2. волна — одобренная владельцем: раз в 6–9 с по клеткам 36 px проходит
 *     рваный фронт, клетка на миг встаёт тёмной со светлой вспышкой;
 *  3. ступенчатая виньетка.
 *
 * Фон сам не шевелится — двигается волна и искры: искры ≤30 кадров в
 * секунду, волна ≤60; пауза при скрытом окне и пока поверх идёт игра
 * (lib/renderGate); «Уменьшить движение» — один кадр. Второго WebGL нет: только 2D.
 */

const WCELL = 36 // клетка волны, css px — как у заставки Welcome
const WAVE_SPEED = 0.9 // css px в мс
const FLASH_MS = 520 // клетка живёт: быстро вспыхивает и плавно гаснет
const FLASH_HOT = 90

interface Wave {
  x: number
  y: number
  t0: number
}

interface Scene {
  W: number
  H: number
  dpr: number
  cols: number
  rows: number
  jitter: Float32Array
  pal: Pal
  base: HTMLCanvasElement
  vignette: HTMLCanvasElement
  waves: Wave[]
  nextWave: number
  /** Волна на прошлом кадре была — нужен ещё кадр, чтобы стереть её след. */
  dirty: boolean
  cell: number
  ox: number
  oy: number
  /** Клетки, закрашенные на прошлом кадре: их восстанавливаем из base. */
  prev: Set<number>
}

const images = new Map<string, HTMLImageElement>()
/** Картинка из кэша; пока грузится — null, по загрузке зовём onload. */
function image(src: string, onload: () => void) {
  let im = images.get(src)
  if (!im) {
    im = new Image()
    im.decoding = 'async'
    im.src = src
    images.set(src, im)
  }
  if (!im.complete) {
    im.addEventListener('load', onload, { once: true })
    return null
  }
  return im
}

function build(w: number, h: number, dpr: number, stage: boolean, onImg: () => void): Scene {
  const W = Math.round(w * dpr)
  const H = Math.round(h * dpr)
  const grid = stageGrid(W, H, dpr)
  const cols = Math.ceil(W / grid.cell) + 2
  const rows = Math.ceil(H / grid.cell) + 2
  // Рваный фронт волны: у каждой клетки своя задержка (0–3 клетки).
  const jitter = new Float32Array(cols * rows)
  for (let i = 0; i < jitter.length; i++) jitter[i] = Math.random() * 3
  const pal = makePal(accentBase(), shade)
  return {
    W,
    H,
    dpr,
    cols,
    rows,
    jitter,
    pal,
    base: paintScene(W, H, dpr, pal, image(WORLD_SRC, onImg), stage),
    vignette: paintVignette(W, H, pal, dpr),
    waves: [],
    nextWave: performance.now() + 1200,
    dirty: true,
    cell: grid.cell,
    ox: grid.ox,
    oy: grid.oy,
    prev: new Set(),
  }
}

function spawnWave(s: Scene, now: number) {
  const w = s.W / s.dpr
  const h = s.H / s.dpr
  const side = Math.floor(Math.random() * 4)
  const t = Math.random()
  const x = side === 0 ? 0 : side === 1 ? w : t * w
  const y = side === 2 ? 0 : side === 3 ? h : t * h
  s.waves.push({ x, y, t0: now })
  s.nextWave = now + 6000 + Math.random() * 3000
}

function paint(ctx: CanvasRenderingContext2D, s: Scene, now: number, animate: boolean) {
  const d = s.dpr
  const w = s.W / d
  const h = s.H / d
  ctx.imageSmoothingEnabled = false
  if (!animate || s.dirty) {
    // Полная перерисовка — только при старте и смене размера/цвета.
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(s.base, 0, 0)
    ctx.drawImage(s.vignette, 0, 0)
    s.prev.clear()
    s.dirty = false
    if (!animate) return
  }
  if (now > s.nextWave) spawnWave(s, now)
  const life = (Math.hypot(w, h) * 0.72 + 3 * WCELL) / WAVE_SPEED + FLASH_MS
  s.waves = s.waves.filter((v) => now - v.t0 < life)
  if (!s.waves.length && !s.prev.size) return

  // Перерисовываем только клетки, которые меняются: 60 кадров без рывков.
  const cs = s.cell
  const next = new Set<number>()
  const top = Math.max(1, Math.round(3 * d))
  const bot = Math.max(1, Math.round(4 * d))
  const restore = (i: number) => {
    const X = Math.round(s.ox + ((i % s.cols) - 1) * cs)
    const Y = Math.round(s.oy + (Math.floor(i / s.cols) - 1) * cs)
    ctx.drawImage(s.base, X, Y, cs, cs, X, Y, cs, cs)
    return [X, Y]
  }
  for (let y = 0; y < s.rows; y++) {
    for (let x = 0; x < s.cols; x++) {
      const i = y * s.cols + x
      const X = s.ox + (x - 1) * cs
      const Y = s.oy + (y - 1) * cs
      const cx = (X + cs / 2) / d
      const cy = (Y + cs / 2) / d
      const j = s.jitter[i % s.jitter.length] * WCELL
      let k = 0
      for (const v of s.waves) {
        const dt = now - v.t0 - (Math.hypot(cx - v.x, cy - v.y) * 0.72 + j) / WAVE_SPEED
        if (dt <= 0 || dt >= FLASH_MS) continue
        // Быстрый вход, плавный выход (ступенями по 4, как пиксель-арт).
        const a = dt < FLASH_HOT ? dt / FLASH_HOT : 1 - (dt - FLASH_HOT) / (FLASH_MS - FLASH_HOT)
        k = Math.max(k, Math.ceil(a * 4) / 4)
      }
      if (k <= 0) {
        if (s.prev.has(i)) restore(i)
        continue
      }
      next.add(i)
      const [RX, RY] = restore(i)
      ctx.fillStyle = 'rgba(' + s.pal.flash + ',' + (0.75 * k).toFixed(3) + ')'
      ctx.fillRect(RX, RY, cs, cs)
      ctx.fillStyle = 'rgba(255,255,255,' + (0.25 * k).toFixed(3) + ')'
      ctx.fillRect(RX, RY, cs, top)
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.fillRect(RX, RY + cs - bot, cs, bot)
    }
  }
  s.prev = next
}

/** Искры как опыт и частицы зачарования Minecraft: пиксели 6 px поднимаются
 * вокруг персонажа, мерцают ступенями; в лучах иногда вспыхивают блёстки-
 * крестики (правка владельца 22:14: «больше деталей, проработки»). */
interface Spark {
  x: number
  y: number
  vy: number
  sway: number
  born: number
  life: number
  warm: boolean
  size: number
  star: boolean
}

function spawnSpark(w: number, h: number, now: number, star = false): Spark {
  const x = star ? w * (0.2 + Math.random() * 0.6) : w * (0.32 + Math.random() * 0.36)
  const y = star ? h * (0.12 + Math.random() * 0.5) : h * (0.35 + Math.random() * 0.4)
  return {
    x,
    y,
    vy: star ? 0 : 10 + Math.random() * 22,
    sway: Math.random() * Math.PI * 2,
    born: now,
    life: star ? 700 + Math.random() * 500 : 2600 + Math.random() * 2600,
    warm: Math.random() < 0.4,
    size: star ? 3 : Math.random() < 0.3 ? 8 : 5,
    star,
  }
}

function paintSparks(g: CanvasRenderingContext2D, list: Spark[], now: number, dpr: number, pal: Pal) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height)
  const green = 'rgb(' + pal.light + ')'
  const warm = '#ffe27a'
  for (const p of list) {
    const t = (now - p.born) / p.life
    if (t < 0 || t > 1) continue
    // Мерцание ступенями: 4 уровня яркости, в начале и в конце — гаснет.
    const env = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1
    const tw = 0.6 + 0.4 * Math.sin((now - p.born) / 140 + p.sway)
    const a = Math.ceil(env * tw * 4) / 4
    if (a <= 0) continue
    g.globalAlpha = a
    g.fillStyle = p.warm ? warm : green
    const px = Math.round((p.x + Math.sin((now - p.born) / 700 + p.sway) * 6) * dpr)
    const py = Math.round((p.y - (p.vy * (now - p.born)) / 1000) * dpr)
    const u = Math.round(p.size * dpr)
    if (p.star) {
      // Крестик 3×3 клетки: центр ярче, лучи.
      g.fillRect(px - u, py, u * 3, u)
      g.fillRect(px, py - u, u, u * 3)
      g.globalAlpha = Math.min(1, a + 0.25)
      g.fillStyle = '#ffffff'
      g.fillRect(px, py, u, u)
    } else {
      g.fillRect(px, py, u, u)
    }
  }
  g.globalAlpha = 1
}

export function PixelField({ on }: { on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv || !on) return
    const ctx = cv.getContext('2d', { alpha: false })
    if (!ctx) return
    // Лёгкая графика после сбоя видеокарты — один статичный кадр без искр.
    const lite = gpuLite()
    const still = () => lite || matchMedia('(prefers-reduced-motion: reduce)').matches || !bgAnimOn()
    let scene: Scene | null = null
    let raf = 0
    const fx = fxRef.current
    const fxg = fx ? fx.getContext('2d') : null
    let sparks: Spark[] = []
    let nextStar = 0
    let alive = true

    const fit = () => {
      if (!alive) return
      const r = cv.getBoundingClientRect()
      if (!r.width || !r.height) return
      // Два холста во всё окно: при DPR 2 это ~40 МБ видеопамяти. Пиксель-арт
      // выше 1.5 не выигрывает, в лёгкой графике — 1; слабые устройства режут сильнее.
      const dpr = lite ? 1 : Math.min(window.devicePixelRatio || 1, 1.5, maxCanvasPixelRatio(currentDeviceTier()))
      scene = build(r.width, r.height, dpr, !!cv.closest('.lobby'), fit)
      cv.width = scene.W
      cv.height = scene.H
      // Искр без движения нет — и буфер под них не нужен.
      if (fx) {
        fx.width = still() ? 0 : scene.W
        fx.height = still() ? 0 : scene.H
      }
      paint(ctx, scene, performance.now(), false)
    }

    let lastFrame = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (!scene) return
      // Кадр волны — до 60 в секунду (одобрено владельцем), искрам в
      // промежутке хватает 30: мерцание ступенчатое. На мониторе 144 Гц
      // холст во всё окно больше не перерисовывается 144 раза в секунду.
      const gap = scene.waves.length || scene.prev.size ? 15 : 32
      if (now - lastFrame < gap) return
      lastFrame = now
      paint(ctx, scene, now, true)
      if (fxg) {
        const w = scene.W / scene.dpr
        const h = scene.H / scene.dpr
        sparks = sparks.filter((p) => now - p.born < p.life)
        while (sparks.filter((p) => !p.star).length < 34) {
          const p = spawnSpark(w, h, now)
          p.born -= Math.random() * p.life * 0.9
          sparks.push(p)
        }
        if (now > nextStar) {
          sparks.push(spawnSpark(w, h, now, true))
          nextStar = now + 350 + Math.random() * 700
        }
        paintSparks(fxg, sparks, now, scene.dpr, scene.pal)
      }
    }
    const run = () => {
      cancelAnimationFrame(raf)
      raf = 0
      if (!still() && !document.hidden && renderLive()) raf = requestAnimationFrame(tick)
      else if (scene) {
        // Анимацию фона выключили — оставляем статичный кадр без волны и искр.
        paint(ctx, scene, performance.now(), false)
        if (fxg) fxg.clearRect(0, 0, scene.W, scene.H)
      }
    }

    fit()
    run()
    const ro = new ResizeObserver(() => fit())
    ro.observe(cv)
    document.addEventListener('visibilitychange', run)
    window.addEventListener(VIEW_PREFS_EVENT, run)
    const offGate = onRenderGate(run)
    // Цвет кнопок сменили в Настройках — сцена перекрашивается целиком. Пока
    // тянут ползунок, событие летит десятки раз в секунду: перерисовка — через
    // 150 мс после последнего.
    let recolor = 0
    const onAccent = () => {
      clearTimeout(recolor)
      recolor = window.setTimeout(fit, 150)
    }
    window.addEventListener(ACCENT_EVENT, onAccent)
    return () => {
      alive = false
      clearTimeout(recolor)
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener(VIEW_PREFS_EVENT, run)
      offGate()
      window.removeEventListener(ACCENT_EVENT, onAccent)
    }
  }, [on])

  return (
    <>
      <canvas ref={ref} className="pixel-field" aria-hidden="true" />
      <canvas ref={fxRef} className="pixel-field pixel-fx" aria-hidden="true" />
    </>
  )
}
