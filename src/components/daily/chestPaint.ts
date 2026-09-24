import type { ChestTier } from '../../lib/rubies'

/**
 * Пиксельная текстура сундука, нарисованная кодом (23.09.2026).
 *
 * Чужих ассетов Mojang нет: каждая грань — холст по одному пикселю на тексель,
 * те же правила, что у сундука в игре (доски, тёмная кайма по краю, окантовка
 * углов, замок). Один художник на 3D-сундук (грани куба) и на 2D-запасной
 * рисунок, чтобы они не расходились по цвету.
 *
 * Цвета — не токены интерфейса: это краска предмета мира, как у рубина
 * (public/ruby.webp), и от темы лаунчера она не зависит.
 */
export interface ChestPalette {
  out: string
  dark: string
  main: string
  light: string
  hi: string
  trimDark: string
  trim: string
  trimLight: string
  inside: string
  /** Цвет света из сундука: столб, искры, ореол. */
  glow: string
  /** Второй цвет искр. */
  spark: string
}

const GOLD = { trimDark: '#9a6a08', trim: '#e8b923', trimLight: '#ffe685' }

export const CHEST_PALETTE: Record<ChestTier, ChestPalette> = {
  COMMON: {
    out: '#2e1a08',
    dark: '#6a4116',
    main: '#9c6428',
    light: '#b97c38',
    hi: '#d69a52',
    trimDark: '#3c4148',
    trim: '#8d949e',
    trimLight: '#d3d8de',
    inside: '#1c1006',
    glow: '#ffd56a',
    spark: '#fff1b8',
  },
  RARE: {
    out: '#0b1a44',
    dark: '#1b3b94',
    main: '#2c5bd1',
    light: '#437cf0',
    hi: '#79a6ff',
    ...GOLD,
    inside: '#08112e',
    glow: '#58b0ff',
    spark: '#ffe685',
  },
  EPIC: {
    out: '#210c42',
    dark: '#4a2090',
    main: '#7338d0',
    light: '#9158ec',
    hi: '#bb8cff',
    ...GOLD,
    inside: '#14062a',
    glow: '#c07bff',
    spark: '#ffe685',
  },
  // Золото с алыми ремнями — тот же материал, что у 2D-рисунка (chestSprite.ts).
  LEGEND: {
    out: '#351c02',
    dark: '#a4680a',
    main: '#e0a51d',
    light: '#f5c83b',
    hi: '#fff09c',
    trimDark: '#560d17',
    trim: '#b01f2d',
    trimLight: '#ff6b6b',
    inside: '#2a1502',
    glow: '#ffd84a',
    spark: '#fffbe0',
  },
}

/** Детерминированный шум: одна и та же грань всегда выглядит одинаково. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

export type FaceKind = 'bodyFront' | 'bodySide' | 'bodyBack' | 'lidFront' | 'lidSide' | 'lidTop' | 'inside' | 'bottom' | 'latch'

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.fillStyle = c
  ctx.fillRect(x, y, 1, 1)
}

/**
 * Рисует грань `w×h` текселей в `ctx` со сдвигом (ox, oy).
 * Доски идут горизонтально, шов — через каждые 4 ряда; редкий и эпический
 * сундук окованы золотом по краю, обычный — железными уголками.
 */
export function paintFace(
  ctx: CanvasRenderingContext2D,
  kind: FaceKind,
  tier: ChestTier,
  w: number,
  h: number,
  ox = 0,
  oy = 0,
  seed = 1,
) {
  const p = CHEST_PALETTE[tier]
  const gold = tier !== 'COMMON'
  if (kind === 'inside' || kind === 'bottom') {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const n = hash(x, y, seed)
        px(ctx, ox + x, oy + y, kind === 'inside' ? (n > 0.8 ? p.out : p.inside) : n > 0.5 ? p.dark : p.out)
      }
    return
  }
  if (kind === 'latch') {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        px(ctx, ox + x, oy + y, edge ? p.trimDark : y === 1 ? p.trimLight : p.trim)
      }
    // Скважина замка.
    if (w >= 2 && h >= 3) px(ctx, ox + Math.floor(w / 2), oy + h - 2, p.out)
    return
  }

  const lid = kind === 'lidFront' || kind === 'lidSide' || kind === 'lidTop'
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = hash(x, y, seed)
      let c = n < 0.18 ? p.dark : n < 0.72 ? p.main : n < 0.94 ? p.light : p.hi
      // Шов между досками.
      if (kind !== 'lidTop' && (y + (lid ? 1 : 0)) % 4 === 3) c = n < 0.5 ? p.dark : p.out
      if (kind === 'lidTop' && x % 5 === 4) c = n < 0.5 ? p.dark : p.main
      // Светлая грань сверху у крышки: свет падает сверху.
      if (lid && kind !== 'lidTop' && y === 1) c = n < 0.6 ? p.light : p.hi
      px(ctx, ox + x, oy + y, c)
    }
  }

  // Окантовка.
  if (gold) {
    for (let x = 1; x < w - 1; x++) {
      px(ctx, ox + x, oy + 1, x % 3 === 0 ? p.trimLight : p.trim)
      px(ctx, ox + x, oy + h - 2, p.trimDark)
    }
    for (let y = 1; y < h - 1; y++) {
      px(ctx, ox + 1, oy + y, y === 1 ? p.trimLight : p.trim)
      px(ctx, ox + w - 2, oy + y, p.trimDark)
    }
    if (kind === 'lidTop') {
      // Самоцвет в центре крышки.
      const cx = Math.floor(w / 2) - 1
      const cy = Math.floor(h / 2) - 1
      px(ctx, ox + cx, oy + cy, p.trimLight)
      px(ctx, ox + cx + 1, oy + cy, p.trim)
      px(ctx, ox + cx, oy + cy + 1, p.trim)
      px(ctx, ox + cx + 1, oy + cy + 1, p.trimDark)
      for (const [dx, dy] of [
        [-1, 0],
        [2, 1],
        [0, -1],
        [1, 2],
      ] as const)
        px(ctx, ox + cx + dx, oy + cy + dy, p.hi)
    }
  } else {
    // Железные уголки 2×2.
    const corners: [number, number][] = [
      [1, 1],
      [w - 3, 1],
      [1, h - 3],
      [w - 3, h - 3],
    ]
    for (const [cx, cy] of corners) {
      if (cy < 0 || cy + 1 >= h) continue
      px(ctx, ox + cx, oy + cy, p.trimLight)
      px(ctx, ox + cx + 1, oy + cy, p.trim)
      px(ctx, ox + cx, oy + cy + 1, p.trim)
      px(ctx, ox + cx + 1, oy + cy + 1, p.trimDark)
    }
  }

  // Тёмная кайма по краю — главный признак сундука Minecraft.
  for (let x = 0; x < w; x++) {
    px(ctx, ox + x, oy, p.out)
    px(ctx, ox + x, oy + h - 1, p.out)
  }
  for (let y = 0; y < h; y++) {
    px(ctx, ox, oy + y, p.out)
    px(ctx, ox + w - 1, oy + y, p.out)
  }
}

export function faceCanvas(kind: FaceKind, tier: ChestTier, w: number, h: number, seed = 1): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (ctx) paintFace(ctx, kind, tier, w, h, 0, 0, seed)
  return c
}

const flatCache = new Map<string, string>()

/**
 * 2D-сундук для мест без WebGL и для плашки лобби: вид спереди чуть сверху,
 * 16×18 текселей — крышка сверху (3 ряда), крышка спереди (5), корпус (10).
 */
export function flatChestUrl(tier: ChestTier, open = false): string {
  const key = tier + (open ? ':o' : '')
  const hit = flatCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 18
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const p = CHEST_PALETTE[tier]
  if (open) {
    // Крышка откинута назад: видно тёмное нутро и свет из него.
    paintFace(ctx, 'lidFront', tier, 16, 5, 0, 0, 7)
    paintFace(ctx, 'inside', tier, 16, 3, 0, 5, 3)
    ctx.fillStyle = p.glow
    ctx.fillRect(3, 6, 10, 1)
    ctx.fillStyle = p.spark
    ctx.fillRect(5, 6, 6, 1)
  } else {
    paintFace(ctx, 'lidTop', tier, 16, 3, 0, 0, 5)
    paintFace(ctx, 'lidFront', tier, 16, 5, 0, 3, 7)
  }
  paintFace(ctx, 'bodyFront', tier, 16, 10, 0, 8, 11)
  // Замок висит на шве крышки и корпуса.
  if (!open) paintFace(ctx, 'latch', tier, 2, 4, 7, 6, 1)
  const url = c.toDataURL('image/png')
  flatCache.set(key, url)
  return url
}
