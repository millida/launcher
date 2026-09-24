import { useEffect, useRef } from 'react'
import { blockColors, renderScene } from './iso'
import type { Rendered } from './iso'

/**
 * Живой OneBlock для слота в лобби (правка владельца 23.09.2026, 22:58:
 * «привлекающая кнопка на уровне систем Minecraft, анимированная внутри»).
 * Сама механика режима: блок висит в небе, трескается, разлетается осколками
 * и появляется следующий — трава, камень, бревно, руды, TNT, лаки-блок.
 *
 * Холст в родном разрешении сцены, на экран — целым шагом без сглаживания.
 * Кадры блоков (три размера «появления») считаются один раз.
 */

const W = 100
const H = 48
const CYCLE = ['grass', 'stone', 'log', 'gold_ore', 'diamond_ore', 'tnt', 'lucky', 'emerald_ore']
const POP = [0.5, 0.75, 1]
const T_POP = 240
const T_CRACK = 1500
const T_BREAK = 2100

interface Frames {
  sizes: Rendered[]
  colors: string[]
  /** Где у полного блока есть пиксели — трещины только по блоку, не по небу. */
  mask: (x: number, y: number) => boolean
}

const cache = new Map<string, Frames>()
function frames(b: string): Frames {
  const hit = cache.get(b)
  if (hit) return hit
  const sizes = POP.map((k) => renderScene([{ b, x: 0, y: 0, z: 0, k }]))
  const full = sizes[2]!
  const px = full.canvas.getContext('2d')?.getImageData(0, 0, full.w, full.h).data
  const mask = (x: number, y: number) =>
    !!px && x > 0 && y > 0 && x < full.w - 1 && y < full.h - 1 && px[(y * full.w + x) * 4 + 3]! > 0
  const f = { sizes, colors: blockColors(b), mask }
  cache.set(b, f)
  return f
}

/** Трещины: пиксели лучами от центра грани; стадия открывает первые n точек. */
function cracks(seed: number): [number, number][] {
  const pts: [number, number][] = []
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
  for (let ray = 0; ray < 5; ray++) {
    let x = 16 + Math.round(rnd() * 4 - 2)
    let y = 18 + Math.round(rnd() * 4 - 2)
    const dx = rnd() * 2 - 1
    const dy = rnd() * 2 - 1
    for (let i = 0; i < 9; i++) {
      x += Math.round(dx + (rnd() - 0.5))
      y += Math.round(dy + (rnd() - 0.5))
      pts.push([x, y])
    }
  }
  // Порядок раскрытия — по шагу луча: трещина растёт от центра наружу.
  return pts.map((p, i) => [p, (i % 9) * 10 + Math.floor(i / 9)] as const).sort((a, b) => a[1] - b[1]).map((a) => a[0])
}

interface Chip {
  x: number
  y: number
  vx: number
  vy: number
  c: string
  life: number
}

function Sky(g: CanvasRenderingContext2D) {
  const bands = ['#4fa8e8', '#5cb3ee', '#6dbff3', '#84cbf6']
  bands.forEach((c, i) => {
    g.fillStyle = c
    g.fillRect(0, Math.round((H / bands.length) * i), W, Math.ceil(H / bands.length))
  })
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, u: number) {
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.fillRect(Math.round(x + u), y, u * 3, u)
  g.fillRect(Math.round(x), y + u, u * 6, u)
}

export function OneBlockLive({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    cv.width = W
    cv.height = H
    g.imageSmoothingEnabled = false
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const clouds = [
      { x: 4, y: 5, u: 3, v: 0.006 },
      { x: 52, y: 12, u: 2, v: 0.01 },
      { x: 86, y: 3, u: 2, v: 0.008 },
    ]
    let idx = 0
    let t0 = performance.now()
    let crack = cracks(7)
    let chips: Chip[] = []
    let raf = 0
    let last = t0
    // Блок — справа, текст карточки слева.
    const BX = 78
    const BY = 24

    const draw = (now: number) => {
      const dt = Math.min(50, now - last)
      last = now
      const t = still ? 900 : now - t0
      if (t >= T_BREAK) {
        const f = frames(CYCLE[idx]!)
        for (let i = 0; i < 16; i++)
          chips.push({
            x: BX + (Math.random() * 20 - 10),
            y: BY + (Math.random() * 16 - 8),
            vx: Math.random() * 0.08 - 0.04,
            vy: -0.05 - Math.random() * 0.05,
            c: f.colors[i % f.colors.length]!,
            life: 700,
          })
        idx = (idx + 1) % CYCLE.length
        t0 = now
        crack = cracks(7 + idx * 13)
      }

      Sky(g)
      for (const c of clouds) {
        if (!still) c.x -= c.v * dt
        if (c.x < -c.u * 7) c.x = W + 2
        cloud(g, c.x, c.y, c.u)
      }

      const f = frames(CYCLE[idx]!)
      const tt = now - t0
      const size = still ? 2 : tt < T_POP / 2 ? 0 : tt < T_POP ? 1 : 2
      const r = f.sizes[size]!
      // Покачивание на 1 пиксель ступенькой — остров висит в воздухе.
      const bob = still ? 0 : Math.floor(now / 600) % 2
      const x = Math.round(BX - r.w / 2)
      const y = Math.round(BY - r.h / 2) + bob
      // Тень-осколки под блоком.
      g.fillStyle = 'rgba(40,70,110,0.35)'
      g.fillRect(BX - 8, 44, 16, 2)
      g.drawImage(r.canvas, x, y)
      if (size === 2 && tt > T_CRACK) {
        const n = Math.floor(((tt - T_CRACK) / (T_BREAK - T_CRACK)) * crack.length)
        g.fillStyle = 'rgba(20,12,16,0.85)'
        for (let i = 0; i < n; i++) {
          const [cx, cy] = crack[i]!
          if (f.mask(cx, cy)) g.fillRect(x + cx, y + cy, 1, 1)
        }
      }

      chips = chips.filter((c) => (c.life -= dt) > 0)
      for (const c of chips) {
        c.vy += 0.00025 * dt
        c.x += c.vx * dt
        c.y += c.vy * dt
        g.fillStyle = c.c
        g.fillRect(Math.round(c.x), Math.round(c.y), 2, 2)
      }

      if (!still) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    // Окно свернули — не жжём кадры.
    const vis = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden && !still) {
        last = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }
    document.addEventListener('visibilitychange', vis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
