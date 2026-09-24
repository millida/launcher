import type { ChestTier } from '../../lib/rubies'

/**
 * Пиксель-арт сундуков витрины и открытия (24.09.2026, жалоба владельца
 * «кейсы визуально полное дерьмо — сами сундуки должны быть охуенными»).
 *
 * Сетка 40×46 клеток, вид три четверти, как у сундуков Brawl Stars и Clash:
 * видно крышку сверху и лицевую сторону. Каждый уровень — свой материал и свой
 * силуэт, чтобы уровень читался издалека, даже без цвета:
 *   обычный     — дерево, железные уголки, низкая крышка;
 *   редкий      — синяя сталь в заклёпках, окованные углы и ножки;
 *   эпический   — аметист: гранёный корпус, золото, друзы кристаллов на крышке;
 *   легендарный — золото, алые ремни, корона и бирюзовый камень в замке.
 *
 * Рисуется кодом, клетка = пиксель, без сглаживания: показывать только
 * целым множителем (×4, ×6, ×7) и с image-rendering: pixelated. Контур
 * ставится последним проходом по силуэту — поэтому он сплошной вокруг
 * кристаллов и короны (приказ 23.09.2026 о сплошной обводке).
 *
 * Цвета — краска предмета мира, как у рубина: от темы лаунчера не зависят.
 */

export const SPRITE_W = 40
export const SPRITE_H = 46

export interface SpritePalette {
  out: string
  dark: string
  main: string
  light: string
  hi: string
  trimDark: string
  trim: string
  trimLight: string
  gem: string
  gemLight: string
  inside: string
  /** Свет из щелей и из открытого сундука. */
  glow: string
  glowHi: string
}

export const SPRITE_PALETTE: Record<ChestTier, SpritePalette> = {
  COMMON: {
    out: '#241205',
    dark: '#653a13',
    main: '#955c27',
    light: '#b57838',
    hi: '#d99f59',
    trimDark: '#373c43',
    trim: '#7c848e',
    trimLight: '#c8cdd4',
    gem: '#8e979f',
    gemLight: '#e6eaee',
    inside: '#1a0e05',
    glow: '#ffcf52',
    glowHi: '#fff4c2',
  },
  RARE: {
    out: '#08122e',
    dark: '#1a3582',
    main: '#2753c4',
    light: '#3f76ea',
    hi: '#7eabff',
    trimDark: '#4a5361',
    trim: '#a7b2c2',
    trimLight: '#f1f5fa',
    gem: '#26c6ff',
    gemLight: '#c8f4ff',
    inside: '#060d24',
    glow: '#4fb2ff',
    glowHi: '#d9f0ff',
  },
  EPIC: {
    out: '#1a0836',
    dark: '#3f1d84',
    main: '#6532c2',
    light: '#8653e4',
    hi: '#b98cff',
    trimDark: '#855404',
    trim: '#dfa81c',
    trimLight: '#ffe27c',
    gem: '#ff4fd0',
    gemLight: '#ffd0f3',
    inside: '#12052a',
    glow: '#c77dff',
    glowHi: '#f3e3ff',
  },
  LEGEND: {
    out: '#351c02',
    dark: '#a4680a',
    main: '#e0a51d',
    light: '#f5c83b',
    hi: '#fff09c',
    trimDark: '#560d17',
    trim: '#b01f2d',
    trimLight: '#ff6b6b',
    gem: '#2fe6d6',
    gemLight: '#d6fffb',
    inside: '#2a1502',
    glow: '#ffd84a',
    glowHi: '#fffbe0',
  },
}

/** Кристаллы аметиста эпического сундука. */
const AMETHYST = { dark: '#5a22b8', main: '#a46cff', light: '#dcbcff', hi: '#ffffff' }

export interface SpriteState {
  /** 0 — целый; дальше трещины со светом, по одной ступени на удар. */
  crack?: number
  /** Крышка поднята, изнутри свет. */
  open?: boolean
  /** Без цвета: пустая плитка «0». */
  gray?: boolean
}

type Grid = (string | null)[]

/** Детерминированный шум: одна и та же клетка всегда одного цвета. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/**
 * Геометрия: корпус x 5..34, лицо корпуса y 27..40; крышка y 15..26
 * (верх крышки — светлые ряды 15..19, лицо — 20..26). Открытая крышка
 * поднимается на LIFT клеток.
 */
const X0 = 5
const X1 = 34
const LID0 = 15
const LID_FACE = 20
const LID1 = 26
const BODY0 = 27
const BODY1 = 40
const LIFT = 8

/** Скругление крышки: на сколько клеток ряд уже от краёв. */
const DOME: Record<ChestTier, number[]> = {
  COMMON: [3, 1, 0],
  RARE: [3, 1, 0],
  EPIC: [4, 2, 1, 0],
  LEGEND: [4, 2, 1, 0],
}

/** Пути трещин: клетки на лице корпуса и крышки, открываются по ступеням. */
const CRACKS: [number, number][][] = [
  // 1: от замка вниз-влево
  [[16, 31], [15, 32], [15, 33], [14, 34], [13, 35], [13, 36]],
  // 2: от замка вправо-вниз + щель под крышкой
  [[24, 30], [25, 31], [26, 31], [27, 32], [28, 33], [28, 34], [29, 35], [12, 37], [11, 38]],
  // 3: трещины по крышке
  [[14, 22], [13, 23], [13, 24], [12, 25], [25, 21], [26, 22], [26, 23], [27, 24], [9, 30], [8, 31], [8, 32]],
  // 4: всё в свету
  [[31, 29], [31, 30], [30, 31], [20, 37], [21, 38], [19, 38], [22, 24], [22, 25], [18, 23], [30, 22], [31, 23], [7, 23], [8, 24]],
]

function paint(tier: ChestTier, st: SpriteState): Grid {
  const p = SPRITE_PALETTE[tier]
  const g: Grid = new Array(SPRITE_W * SPRITE_H).fill(null)
  const put = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < SPRITE_W && y < SPRITE_H) g[y * SPRITE_W + x] = c
  }
  const get = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < SPRITE_W && y < SPRITE_H ? g[y * SPRITE_W + x] : null
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c)
  }
  const lift = st.open ? LIFT : 0
  const crack = Math.max(0, Math.min(CRACKS.length, st.crack || 0))

  /* ── Корпус ── */
  const bodyBase = () => {
    rect(X0, BODY0, X1, BODY1, p.main)
    // Объём: левая грань светлее, правая темнее, низ в тени.
    rect(X0, BODY0, X0 + 1, BODY1, p.light)
    rect(X1 - 2, BODY0, X1, BODY1, p.dark)
    rect(X0, BODY1 - 1, X1, BODY1, p.dark)
    rect(X0 + 2, BODY0 + 1, X1 - 3, BODY0 + 1, p.light)
  }
  bodyBase()

  if (tier === 'COMMON') {
    // Доски: шов каждые 4 ряда, сучки и волокна шумом.
    for (let y = BODY0 + 1; y < BODY1 - 1; y++) {
      const seam = (y - BODY0) % 4 === 0
      for (let x = X0 + 2; x < X1 - 2; x++) {
        if (seam) put(x, y, p.dark)
        else if (hash(x, y, 3) > 0.9) put(x, y, p.light)
        else if (hash(x, y, 5) > 0.93) put(x, y, p.dark)
      }
    }
  } else if (tier === 'RARE') {
    // Стальные листы: вертикальные швы и заклёпки по углам листов.
    for (const sx of [13, 26])
      for (let y = BODY0 + 1; y < BODY1 - 1; y++) {
        put(sx, y, p.dark)
        put(sx + 1, y, p.light)
      }
    for (let x = X0 + 2; x < X1 - 2; x++) put(x, BODY0 + 7, p.dark)
    for (const [rx, ry] of [
      [X0 + 3, BODY0 + 3], [X1 - 4, BODY0 + 3], [X0 + 3, BODY1 - 3], [X1 - 4, BODY1 - 3],
      [11, BODY0 + 5], [28, BODY0 + 5], [11, BODY1 - 4], [28, BODY1 - 4],
    ] as [number, number][])
      put(rx, ry, p.hi)
  } else if (tier === 'EPIC') {
    // Грани аметиста: диагональные блики и тени.
    for (let y = BODY0 + 2; y < BODY1 - 1; y++)
      for (let x = X0 + 2; x < X1 - 2; x++) {
        const d = (x + y) % 9
        if (d === 0) put(x, y, p.hi)
        else if (d === 1) put(x, y, p.light)
        else if (d === 5 && hash(x, y, 9) > 0.35) put(x, y, p.dark)
      }
  } else {
    // Золото: вдавленная панель с гравировкой.
    for (let y = BODY0 + 2; y < BODY1 - 2; y++)
      for (let x = X0 + 3; x < X1 - 3; x++) {
        const edge = y === BODY0 + 2 || x === X0 + 3
        const edge2 = y === BODY1 - 3 || x === X1 - 4
        put(x, y, edge ? p.dark : edge2 ? p.hi : (x + y) % 6 === 0 ? p.light : p.main)
      }
  }

  // Нижний обод и верхний край корпуса — металл.
  const band = (y0: number, y1: number) => {
    rect(X0, y0, X1, y1, p.trim)
    rect(X0, y0, X1, y0, p.trimLight)
    rect(X0, y1, X1, y1, p.trimDark)
  }
  band(BODY1 - 2, BODY1)
  band(BODY0, BODY0 + 1)
  // Тень под кромкой крышки: крышка нависает над корпусом.
  if (!st.open) for (let x = X0 + 1; x < X1; x++) put(x, BODY0 + 2, p.dark)

  // Ремни через корпус.
  const straps = tier === 'COMMON' ? [9, 29] : [8, 30]
  const strap = (sx: number, y0: number, y1: number) => {
    rect(sx, y0, sx + 2, y1, p.trim)
    rect(sx, y0, sx, y1, p.trimLight)
    rect(sx + 2, y0, sx + 2, y1, p.trimDark)
    if (tier !== 'COMMON')
      for (let y = y0 + 2; y < y1; y += 4) put(sx + 1, y, tier === 'LEGEND' ? '#ffd84a' : p.trimLight)
  }
  for (const sx of straps) strap(sx, BODY0, BODY1)

  // Уголки: у обычного — железные нашлёпки, у редкого и выше — кованые с выступом.
  const corner = (x: number, y: number, dx: number, dy: number, big: boolean) => {
    const n = big ? 4 : 3
    for (let i = 0; i < n; i++) {
      put(x + dx * i, y, p.trim)
      put(x, y + dy * i, p.trim)
    }
    put(x, y, p.trimLight)
    if (big) {
      put(x + dx, y + dy, p.trim)
      put(x - dx, y, p.trimDark)
      put(x - dx, y + dy, p.trimDark)
    }
  }
  const big = tier !== 'COMMON'
  corner(X0, BODY1, 1, -1, big)
  corner(X1, BODY1, -1, -1, big)

  // Ножки у редкого и выше, у легендарного — лапы.
  if (tier !== 'COMMON') {
    const foot = tier === 'LEGEND' ? 3 : 2
    rect(X0 + 1, BODY1 + 1, X0 + 1 + foot, BODY1 + 2, p.trimDark)
    rect(X1 - 1 - foot, BODY1 + 1, X1 - 1, BODY1 + 2, p.trimDark)
    rect(X0 + 1, BODY1 + 1, X0 + 1 + foot, BODY1 + 1, p.trim)
    rect(X1 - 1 - foot, BODY1 + 1, X1 - 1, BODY1 + 1, p.trim)
  }

  // Ручки по бокам у легендарного: кольца.
  if (tier === 'LEGEND') {
    for (const [hx, dir] of [[X0 - 1, -1], [X1 + 1, 1]] as [number, number][]) {
      put(hx, BODY0 + 4, p.trimDark)
      put(hx + dir, BODY0 + 5, p.trimDark)
      put(hx + dir, BODY0 + 6, p.trimDark)
      put(hx, BODY0 + 7, p.trimDark)
      put(hx + dir, BODY0 + 5, '#ffd84a')
    }
  }

  /* ── Открытый сундук: нутро и свет ── */
  if (st.open) {
    // Нутро откинутой крышки: тёмная изнанка между крышкой и корпусом.
    rect(X0 + 1, LID1 - LIFT + 1, X1 - 1, BODY0 - 4, p.inside)
    rect(X0 + 1, LID1 - LIFT + 1, X1 - 1, LID1 - LIFT + 1, p.dark)
    for (const sx of [9, 29]) rect(sx, LID1 - LIFT + 1, sx + 1, BODY0 - 4, p.trimDark)
    rect(X0 + 1, BODY0 - 3, X1 - 1, BODY0 - 1, p.inside)
    rect(X0 + 3, BODY0 - 2, X1 - 3, BODY0 - 1, p.glow)
    rect(X0 + 7, BODY0 - 2, X1 - 7, BODY0 - 2, p.glowHi)
    band(BODY0, BODY0 + 1)
    rect(X0 + 5, BODY0, X1 - 5, BODY0, p.glowHi)
  }

  /* ── Крышка ── */
  const dome = DOME[tier]
  const L0 = LID0 - lift
  const LF = LID_FACE - lift
  const L1 = LID1 - lift
  for (let y = L0; y <= L1; y++) {
    const inset = dome[y - L0] ?? 0
    for (let x = X0 + inset; x <= X1 - inset; x++) {
      const top = y < LF
      let c = top ? (y === L0 ? p.hi : p.light) : p.main
      if (x <= X0 + inset + 1) c = top ? p.hi : p.light
      if (x >= X1 - inset - 1) c = top ? p.main : p.dark
      put(x, y, c)
    }
  }
  // Ребро между верхом и лицом крышки.
  rect(X0, LF, X1, LF, p.hi)
  // Блик на верхе крышки слева: металл и камень блестят, дерево — нет.
  if (tier !== 'COMMON') {
    const sy = L0 + 2
    for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [0, 1], [5, 0], [6, 0]] as [number, number][])
      put(X0 + 3 + dx, sy + dy, '#ffffff')
  }
  // Фактура крышки по материалу.
  for (let y = LF + 1; y < L1; y++)
    for (let x = X0 + 2; x < X1 - 2; x++) {
      if (tier === 'COMMON' && (y - LF) % 3 === 0) put(x, y, p.dark)
      else if (tier === 'COMMON' && hash(x, y, 7) > 0.92) put(x, y, p.light)
      else if (tier === 'EPIC' && (x + y) % 9 === 0) put(x, y, p.hi)
      else if (tier === 'LEGEND' && (x + y) % 6 === 0) put(x, y, p.light)
      else if (tier === 'RARE' && (x === 13 || x === 26)) put(x, y, p.dark)
    }
  // Доски верха крышки у обычного — вдоль, у остальных блик.
  for (let x = X0 + 3; x < X1 - 3; x++) {
    if (tier === 'COMMON' && x % 5 === 0) for (let y = L0 + 1; y < LF; y++) if (get(x, y)) put(x, y, p.main)
  }
  // Нижняя кромка крышки — металл.
  rect(X0, L1, X1, L1, p.trimDark)
  rect(X0, L1 - 1, X1, L1 - 1, p.trim)
  // Ремни через крышку.
  for (const sx of straps) {
    for (let y = L0 + 1; y < L1; y++) {
      const inset = dome[y - L0] ?? 0
      if (sx >= X0 + inset) {
        put(sx, y, p.trimLight)
        put(sx + 1, y, p.trim)
        put(sx + 2, y, p.trimDark)
      }
    }
  }

  /* ── Украшения крышки ── */
  if (tier === 'EPIC') {
    // Друза аметиста: три кристалла, средний выше.
    const crystal = (cx: number, h: number, w: number) => {
      const base = L0 + 1
      for (let i = 0; i < h; i++) {
        const y = base - i
        const half = i >= h - 2 ? 0 : Math.min(w, Math.floor((h - i) / 2))
        for (let x = cx - half; x <= cx + half; x++) {
          const c = x < cx ? AMETHYST.light : x === cx ? AMETHYST.main : AMETHYST.dark
          put(x, y, c)
        }
      }
      put(cx - 1, base - 1, AMETHYST.hi)
      put(cx, base - h + 1, AMETHYST.hi)
    }
    crystal(20, 12, 2)
    crystal(14, 8, 2)
    crystal(26, 9, 2)
    crystal(10, 5, 1)
  }
  if (tier === 'LEGEND') {
    // Корона: обод и три зубца с камнями.
    const cy = L0 - 1
    rect(12, cy - 1, 27, cy, p.light)
    rect(12, cy, 27, cy, p.dark)
    const spike = (cx: number, h: number) => {
      for (let i = 0; i < h; i++) {
        const half = i < h - 3 ? 2 : i < h - 1 ? 1 : 0
        for (let x = cx - half; x <= cx + half; x++) put(x, cy - 2 - i, x < cx ? p.hi : x === cx ? p.light : p.dark)
      }
      // Камень на зубце: 2×2 с бликом.
      rect(cx, cy - 3 - h, cx + 1, cy - 2 - h, p.gem)
      put(cx, cy - 3 - h, p.gemLight)
    }
    spike(13, 4)
    spike(19, 7)
    spike(26, 4)
    put(20, cy - 1, p.gem)
    put(16, cy - 1, p.trim)
    put(24, cy - 1, p.trim)
  }
  if (tier === 'RARE') {
    // Кованые уголки крышки.
    corner(X0, L1 - 1, 1, -1, true)
    corner(X1, L1 - 1, -1, -1, true)
  }

  /* ── Замок ── */
  const lx0 = 16
  const lx1 = 23
  const ly0 = L1 - 3
  const ly1 = BODY0 + 5 - (st.open ? 0 : 0)
  if (!st.open) {
    const lockMain = tier === 'COMMON' ? p.trim : tier === 'RARE' ? '#d8dee8' : tier === 'EPIC' ? p.trim : '#ffd84a'
    const lockDark = tier === 'COMMON' ? p.trimDark : tier === 'RARE' ? '#6b7584' : tier === 'EPIC' ? p.trimDark : p.dark
    const lockLight = tier === 'COMMON' ? p.trimLight : tier === 'RARE' ? '#ffffff' : tier === 'EPIC' ? p.trimLight : p.hi
    rect(lx0, ly0, lx1, ly1, lockMain)
    rect(lx0, ly0, lx1, ly0, lockLight)
    rect(lx0, ly0, lx0, ly1, lockLight)
    rect(lx1, ly0, lx1, ly1, lockDark)
    rect(lx0, ly1, lx1, ly1, lockDark)
    if (tier === 'COMMON') {
      // Скважина.
      rect(19, BODY0 + 1, 20, BODY0 + 2, p.out)
      put(19, BODY0 + 3, p.out)
      put(20, BODY0 + 3, p.out)
    } else {
      // Камень в замке: ромб 4×4.
      const gx = 19
      const gy = BODY0
      rect(gx, gy, gx + 1, gy + 3, p.gem)
      rect(gx - 1, gy + 1, gx + 2, gy + 2, p.gem)
      put(gx, gy + 1, p.gemLight)
      put(gx - 1, gy + 1, p.gemLight)
      put(gx + 1, gy + 3, lockDark)
    }
  } else {
    // Открыт: язычок замка висит на крышке.
    rect(18, L1 + 1, 21, L1 + 3, p.trim)
    rect(18, L1 + 3, 21, L1 + 3, p.trimDark)
  }

  /* ── Трещины со светом ── */
  if (!st.open && crack > 0) {
    for (let s = 0; s < crack; s++)
      for (const [x, y] of CRACKS[s]!) {
        put(x, y, p.glowHi)
        // Свет расходится на соседа ниже-правее: трещина толщиной в полторы клетки.
        if (get(x + 1, y) && hash(x, y, 11) > 0.45) put(x + 1, y, p.glow)
      }
    // Щель под крышкой светится с третьего удара.
    if (crack >= 2)
      for (let x = X0 + 2; x < X1 - 2; x++) if (hash(x, 1, crack) > 0.35) put(x, BODY0 - 1 + 0, p.glow)
  }

  /* ── Контур по силуэту: пустая клетка рядом с заполненной ── */
  const filled = g.map((c) => c !== null)
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++) {
      if (filled[y * SPRITE_W + x]) continue
      const near =
        (x > 0 && filled[y * SPRITE_W + x - 1]) ||
        (x < SPRITE_W - 1 && filled[y * SPRITE_W + x + 1]) ||
        (y > 0 && filled[(y - 1) * SPRITE_W + x]) ||
        (y < SPRITE_H - 1 && filled[(y + 1) * SPRITE_W + x])
      if (near) g[y * SPRITE_W + x] = p.out
    }
  // Контур между крышкой и корпусом закрытого сундука — тёмный шов.
  if (!st.open) for (let x = X0; x <= X1; x++) if (get(x, BODY0 - 1) === null) put(x, BODY0 - 1, p.out)

  if (st.gray)
    for (let i = 0; i < g.length; i++) {
      const c = g[i]
      if (!c) continue
      const n = parseInt(c.slice(1), 16)
      const l = Math.round(((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.55 + (n & 255) * 0.15)
      const v = Math.round(30 + l * 0.45)
      g[i] = 'rgb(' + v + ',' + v + ',' + v + ')'
    }
  return g
}

const cache = new Map<string, string>()

/** Картинка сундука (data URL, клетка = пиксель). Пустая строка без canvas. */
export function chestSprite(tier: ChestTier, st: SpriteState = {}): string {
  const t: ChestTier = tier in SPRITE_PALETTE ? tier : 'COMMON'
  const key = t + ':' + (st.crack || 0) + ':' + (st.open ? 1 : 0) + ':' + (st.gray ? 1 : 0)
  const hit = cache.get(key)
  if (hit) return hit
  if (typeof document === 'undefined') return ''
  const cv = document.createElement('canvas')
  cv.width = SPRITE_W
  cv.height = SPRITE_H
  const ctx = cv.getContext('2d')
  if (!ctx) return ''
  const g = paint(t, st)
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++) {
      const c = g[y * SPRITE_W + x]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(x, y, 1, 1)
    }
  const url = cv.toDataURL('image/png')
  cache.set(key, url)
  return url
}

/** Сколько ступеней трещин есть у рисунка. */
export const CRACK_STEPS = CRACKS.length
