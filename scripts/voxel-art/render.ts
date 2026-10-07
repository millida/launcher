/**
 * Воксельные рисунки валют и пакетов рубинов (06.10.2026).
 *
 * Открывается dev-сервером Vite: http://127.0.0.1:5173/scripts/voxel-art/index.html
 * Рисует модели из вокселей three.js тем же светом, что сундуки (DESIGN-JUICE §3),
 * обводит силуэт тёмной ступенькой и кладёт PNG в window.__art. Сохраняет файлы
 * scripts/voxel-art/save.mjs (headless). В сборку лаунчера не входит.
 */
import * as THREE from 'three'

type Vox = [number, number, number, string]
type Part = { vox: Vox[]; pos?: [number, number, number]; rot?: [number, number, number]; scale?: number }

const rnd = (() => {
  let s = 12345
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
})()

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex)
  c.multiplyScalar(k)
  return '#' + c.getHexString()
}

/* ---------- Модели ---------- */

const RUBY = { table: '#ff8292', crownA: '#f23a54', crownB: '#c41c3a', girdle: '#9e1230', pavA: '#86102b', pavB: '#640a1f', tip: '#440615', hi: '#ffe0e5' }

/** Огранённый камень: площадка, корона, рундист, павильон. */
function gem(p = RUBY, profile = [0, 1, 1, 2, 2, 3, 4, 5, 5, 4, 3], shine = true): Vox[] {
  const out: Vox[] = []
  const top = profile.length - 1
  const girdle = profile.indexOf(Math.max(...profile))
  profile.forEach((r, y) => {
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (Math.abs(x) + Math.abs(z) > r + Math.floor(r / 2)) continue
        let c: string
        if (y === top) c = Math.abs(x) + Math.abs(z) <= Math.max(1, r - 1) ? p.table : p.crownA
        else if (y > girdle) c = (x > 0) !== (z > 0) ? p.crownA : p.crownB
        else if (y === girdle) c = p.girdle
        else if (y === 0) c = p.tip
        else c = (x + z) % 2 === 0 ? p.pavA : p.pavB
        out.push([x, y, z, c])
      }
  })
  // Блики на короне — свет слева сверху.
  if (shine) for (const [x, y, z] of [[-2, top, 0], [-1, top, -1], [-4, top - 1, 0], [-5, top - 2, 1]] as const) out.push([x, y, z, p.hi])
  return dedupe(out)
}

/** Камень поменьше для россыпей. */
const miniGem = (p = RUBY) => gem(p, [0, 1, 2, 3, 3, 2], false)

function dedupe(v: Vox[]): Vox[] {
  const m = new Map<string, Vox>()
  for (const a of v) m.set(Math.round(a[0]) + ',' + Math.round(a[1]) + ',' + Math.round(a[2]), [Math.round(a[0]), Math.round(a[1]), Math.round(a[2]), a[3]])
  return [...m.values()]
}

const SHARD = { hi: '#e2f4ff', a: '#7fd0ff', b: '#3fb0ff', c: '#2287e0', d: '#145a9e', e: '#0c3a6a' }

/** Кристалл осколка: шестигранная колонна с остриями. */
function crystal(h = 12, R = 2, p = SHARD): Vox[] {
  const out: Vox[] = []
  for (let y = 0; y <= h; y++) {
    const r = y < 2 ? y : y > h - 3 ? Math.max(0, h - y) : R
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (Math.abs(x) + Math.abs(z) > r + (r > 1 ? 1 : 0)) continue
        const face = x < 0 && z <= 0 ? p.a : x <= 0 ? p.b : z < 0 ? p.c : p.d
        out.push([x, y, z, y > h - 3 ? (x <= 0 ? p.hi : p.b) : y < 2 ? p.e : face])
      }
  }
  for (let y = 3; y < h - 2; y += 1) if (y % 3 !== 0) out.push([-R, y, -1, p.hi])
  return dedupe(out)
}

/** Фрагмент: обломок кристалла цвета редкости — колонна с отбитой верхушкой. */
function fragment(tone: string): Vox[] {
  const p = { hi: shade(tone, 1.6), a: shade(tone, 1.25), b: tone, c: shade(tone, 0.78), d: shade(tone, 0.58), e: shade(tone, 0.4) }
  const out: Vox[] = []
  for (const v of crystal(9, 2, p)) {
    const [x, y, z] = v
    const cut = 5 + ((x * 3 + z * 5 + 9) % 3)
    if (y > cut) continue
    out.push(y >= cut - 0 ? [x, y, z, p.hi] : v)
  }
  return out
}

const GOLD = { hi: '#fff3b0', a: '#ffd54a', b: '#e8b923', c: '#b88a12', d: '#7d5a06' }

/** Монета: диск с ободком и тиснением. */
function coin(): Vox[] {
  const out: Vox[] = []
  for (let x = -3; x <= 3; x++)
    for (let z = -3; z <= 3; z++) {
      const d = x * x + z * z
      if (d > 11) continue
      const rim = d > 6
      out.push([x, 0, z, rim ? GOLD.c : GOLD.b])
      out.push([x, 1, z, rim ? GOLD.a : (x === 0 || z === 0) && d <= 4 ? GOLD.hi : GOLD.b])
    }
  return out
}

function goldBar(): Vox[] {
  const out: Vox[] = []
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 4; z++) {
        if (y === 2 && (x === 0 || x === 7 || z === 0 || z === 3)) continue
        out.push([x - 4, y, z - 2, y === 2 ? GOLD.a : x === 0 || z === 0 ? GOLD.b : GOLD.c])
      }
  out.push([-2, 2.02, -1, GOLD.hi], [-1, 2.02, -1, GOLD.hi])
  return dedupe(out)
}

const LEATHER = ['#8a5a2b', '#7a4d24', '#9b6833', '#6a411d']

/** Мешочек: округлый, с горлом и золотой завязкой. */
function sack(profile: number[], tieAt: number): Vox[] {
  const out: Vox[] = []
  profile.forEach((r, y) => {
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        if (x * x + z * z > r * r + r) continue
        if (x * x + z * z < (r - 1) * (r - 1) && y > 0 && y < profile.length - 1) continue
        let c = LEATHER[Math.floor(rnd() * LEATHER.length)]
        if (x < -r / 2 && z < 0) c = shade(c, 1.15)
        if (y === tieAt) c = (x + z) % 2 ? GOLD.b : GOLD.a
        if (y === profile.length - 1) c = shade(LEATHER[0], 0.8)
        out.push([x, y, z, c])
      }
  })
  // Шов-стежки спереди.
  for (let y = 1; y < tieAt - 1; y += 2) out.push([0, y, profile[y] + 0.02, '#c9a06a'])
  return out
}

type ChestPal = { out: string; dark: string; main: string; light: string; hi: string; trimDark: string; trim: string; trimLight: string; inside: string }
const WOOD: ChestPal = { out: '#2e1a08', dark: '#6a4116', main: '#9c6428', light: '#b97c38', hi: '#d69a52', trimDark: '#9a6a08', trim: '#e8b923', trimLight: '#ffe685', inside: '#1c1006' }
const EPIC: ChestPal = { out: '#210c42', dark: '#4a2090', main: '#7338d0', light: '#8f55e8', hi: '#b48cff', trimDark: '#9a6a08', trim: '#e8b923', trimLight: '#ffe685', inside: '#140828' }

/** Открытый сундук 14x10x12 без крышки (крышка — отдельной частью). */
function chestBody(p: ChestPal, fill: number): Vox[] {
  const out: Vox[] = []
  const W = 14
  const H = 9
  const D = 12
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      for (let z = 0; z < D; z++) {
        const wall = x === 0 || x === W - 1 || z === 0 || z === D - 1 || y === 0
        if (!wall) continue
        const corner = (x === 0 || x === W - 1) && (z === 0 || z === D - 1)
        const band = y === H - 1 || y === 0
        let c = y % 3 === 0 ? p.dark : y % 3 === 1 ? p.main : p.light
        if (x === 0 || z === D - 1) c = shade(c, 1.12)
        if (corner || band) c = corner ? p.trim : p.trimDark
        if (corner && y % 4 === 1) c = p.trimLight
        out.push([x - W / 2, y, z - D / 2, c])
      }
  // Замок спереди.
  for (const [x, y, c] of [[-1, 6, p.trim], [0, 6, p.trim], [-1, 5, p.trimDark], [0, 5, p.trimLight], [-1, 4, p.trim], [0, 4, p.trim]] as const)
    out.push([x, y, D / 2 - 0.0 + 0, c])
  // Внутри — тёмное дно на высоте заполнения.
  for (let x = 1; x < W - 1; x++) for (let z = 1; z < D - 1; z++) out.push([x - W / 2, fill, z - D / 2, p.inside])
  return out
}

function chestLid(p: ChestPal): Vox[] {
  const out: Vox[] = []
  for (let x = 0; x < 14; x++)
    for (let y = 0; y < 4; y++)
      for (let z = 0; z < 12; z++) {
        const edge = x === 0 || x === 13 || z === 0 || z === 11 || y === 3
        if (!edge) continue
        let c = y === 3 ? (x % 2 ? p.light : p.hi) : y % 2 ? p.main : p.dark
        if ((x === 0 || x === 13) && (z === 0 || z === 11)) c = p.trim
        if (y === 0 && (z === 0 || z === 11)) c = p.trimDark
        out.push([x - 7, y, z - 12, c])
      }
  return out
}

/** Куча рубинов и монет на ровном месте: камни кругом, к центру выше. */
function pile(n: number, radius: number, coins: number, y0 = 0, big = 0.36): Part[] {
  const parts: Part[] = []
  n = Math.ceil(n * 0.6)
  big *= 1.45
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * radius
    const h = y0 + (1 - r / radius) * radius * 0.55
    parts.push({ vox: miniGem(), pos: [Math.cos(a) * r, h, Math.sin(a) * r], rot: [rnd() * 0.8 - 0.4, rnd() * 6, rnd() * 0.8 - 0.4], scale: big * (0.8 + rnd() * 0.4) })
  }
  for (let i = 0; i < coins; i++) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * radius * 1.05
    const h = y0 + (1 - r / radius) * radius * 0.45
    parts.push({ vox: coin(), pos: [Math.cos(a) * r, h, Math.sin(a) * r], rot: [rnd() * 1.2 - 0.6, rnd() * 6, rnd() * 1.2 - 0.6], scale: 0.32 })
  }
  return parts
}

function vault(): Vox[] {
  const out: Vox[] = []
  const S = ['#c3c9d1', '#9aa1ab', '#7a818b', '#5d636b', '#3c4148']
  for (let x = 0; x < 14; x++)
    for (let y = 0; y < 15; y++)
      for (let z = 0; z < 11; z++) {
        if (x > 0 && x < 13 && y > 0 && y < 14 && z > 0 && z < 10) continue
        let c = S[2]
        if (z === 10) c = (x + y) % 7 === 0 ? S[1] : S[2]
        if (x === 0) c = S[1]
        if (y === 14) c = S[0]
        if ((x === 0 || x === 13) && (y === 0 || y === 14)) c = S[4]
        if (z === 10 && (x === 1 || x === 12 || y === 1 || y === 13)) c = S[3]
        out.push([x - 7, y, z - 5, c])
      }
  // Колесо двери, золото.
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2
    out.push([Math.round(Math.cos(t) * 3.4) - 0.5, Math.round(Math.sin(t) * 3.4) + 7, 6, GOLD.b])
  }
  for (let k = -3; k <= 3; k++) {
    out.push([k - 0.5, 7, 6, GOLD.a])
    out.push([-0.5, 7 + k, 6, GOLD.a])
  }
  out.push([-0.5, 7, 7, GOLD.hi])
  // Петли и заклёпки.
  for (const y of [3, 11]) out.push([5.5, y, 6, S[4]], [5.5, y + 1, 6, S[4]])
  return dedupe(out.map((v) => [v[0], v[1], v[2], v[3]]))
}


/** Подарочная коробка стартового пакета: зелёная, с золотой лентой крест-накрест. */
const GIFT = { a: '#3fbf5a', b: '#2f9a47', c: '#22733a', d: '#164f27', hi: '#7fe08f' }
function giftBox(): Vox[] {
  const out: Vox[] = []
  const W = 12
  const H = 10
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      for (let z = 0; z < W; z++) {
        if (x > 0 && x < W - 1 && y > 0 && y < H - 1 && z > 0 && z < W - 1) continue
        const ribbon = x === 5 || x === 6 || z === 5 || z === 6
        let c = y % 2 ? GIFT.b : GIFT.a
        if (x === 0 || z === W - 1) c = shade(c, 1.12)
        if (y === 0) c = GIFT.d
        if ((x === 0 || x === W - 1) && (z === 0 || z === W - 1)) c = GIFT.c
        if (ribbon) c = y % 3 === 0 ? GOLD.b : GOLD.a
        if (ribbon && y === H - 1) c = GOLD.hi
        out.push([x - W / 2, y, z - W / 2, c])
      }
  return out
}
function giftLid(): Vox[] {
  const out: Vox[] = []
  for (let x = 0; x < 14; x++)
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 14; z++) {
        const ribbon = x === 6 || x === 7 || z === 6 || z === 7
        let c = y === 2 ? (x % 2 ? GIFT.a : GIFT.hi) : GIFT.b
        if (y === 0) c = GIFT.c
        if (ribbon) c = y === 2 ? GOLD.hi : GOLD.a
        out.push([x - 7, y, z - 7, c])
      }
  // Бант: две петли и узел.
  for (const [x, y, z, c] of [[-1, 3, 0, GOLD.a], [0, 3, 0, GOLD.a], [-2, 4, 0, GOLD.b], [-3, 4, 0, GOLD.a], [-3, 5, 0, GOLD.hi], [-2, 5, 0, GOLD.a], [1, 4, 0, GOLD.b], [2, 4, 0, GOLD.a], [2, 5, 0, GOLD.hi], [1, 5, 0, GOLD.a], [-0.5, 4, 0, GOLD.c]] as const)
    out.push([x, y, z, c])
  return out
}

/* ---------- Сцены ---------- */

type Scene = { name: string; size: number; parts: Part[]; yaw?: number; pitch?: number; outline?: number; zoom?: number }

const ICON = 192

function scenes(): Scene[] {
  const list: Scene[] = []
  list.push({ name: 'currency/ruby', size: ICON, parts: [{ vox: gem() }], yaw: 0.4, pitch: 0.28 })
  list.push({
    name: 'currency/shard',
    size: ICON,
    parts: [
      { vox: crystal(12, 3), rot: [0, 0, -0.12] },
      { vox: crystal(7, 2), pos: [5, -0.5, 1.5], rot: [0, 0.5, -0.6], scale: 0.85 },
      { vox: crystal(6, 1), pos: [-5, -0.5, 1.6], rot: [0, -0.4, 0.6], scale: 0.85 },
    ],
    yaw: 0.5,
    pitch: 0.25,
  })
  const tones: Record<string, string> = {
    common: '#9aa3a8',
    uncommon: '#5cc04a',
    rare: '#4a93ea',
    epic: '#b061dc',
    legendary: '#f2b733',
    mythic: '#ee4459',
    relic: '#e9e9f2',
  }
  for (const [k, t] of Object.entries(tones)) list.push({ name: 'currency/fragment-' + k, size: ICON, parts: [{ vox: fragment(t), rot: [0, 0.3, -0.35] }], yaw: 0.5, pitch: 0.3 })

  const P = 256
  list.push({ name: 'packs/handful', size: P, parts: [{ vox: gem(), pos: [0, 0, 0], rot: [0.2, 0.4, -0.25], scale: 0.85 }, { vox: miniGem(), pos: [5, -1, 2], rot: [0, 1, 0.3], scale: 0.9 }, { vox: miniGem(), pos: [-4.5, -1.2, 2.5], rot: [0.3, 2, -0.2], scale: 0.8 }] })
  list.push({
    name: 'packs/pouch',
    size: P,
    parts: [
      { vox: sack([3, 4, 5, 5, 5, 5, 4, 3, 2, 2, 3, 3], 8) },
      { vox: miniGem(), pos: [0, 11, 0], rot: [0.3, 0.6, 0.2], scale: 0.6 },
      { vox: miniGem(), pos: [-1.5, 11.4, 1], rot: [-0.2, 1.4, 0.4], scale: 0.5 },
      { vox: miniGem(), pos: [5, 0, 4], rot: [0, 2, 0.4], scale: 0.55 },
    ],
  })
  list.push({
    name: 'packs/purse',
    size: P,
    parts: [
      { vox: sack([4, 5, 6, 7, 7, 7, 7, 6, 5, 3, 3, 4, 4], 9), rot: [0, 0, 0.12] },
      ...pile(4, 2.2, 0, 12.5, 0.55),
      ...pile(6, 6, 7, -0.5, 0.45).map((p) => ({ ...p, pos: [p.pos![0] + 6, p.pos![1], p.pos![2] + 5] as [number, number, number] })),
    ],
  })
  list.push({
    name: 'packs/casket',
    size: P,
    parts: [
      { vox: chestBody(WOOD, 6) },
      { vox: chestLid(WOOD), pos: [0, 9, -6], rot: [-1.15, 0, 0] },
      ...pile(14, 5.2, 4, 7.2, 0.42),
    ],
  })
  list.push({
    name: 'packs/chests',
    size: P,
    parts: [
      { vox: chestBody(WOOD, 6), pos: [-8, 0, -4], rot: [0, 0.25, 0], scale: 0.85 },
      { vox: chestLid(WOOD), pos: [-8, 7.6, -9], rot: [-1.15, 0.25, 0], scale: 0.85 },
      ...pile(10, 4.5, 3, 6.6, 0.38).map((p) => ({ ...p, pos: [p.pos![0] - 8, p.pos![1], p.pos![2] - 4] as [number, number, number] })),
      { vox: chestBody(EPIC, 6), pos: [6, 0, 4], rot: [0, -0.2, 0] },
      { vox: chestLid(EPIC), pos: [6, 9, -2], rot: [-1.15, -0.2, 0] },
      ...pile(14, 5, 4, 7.2, 0.42).map((p) => ({ ...p, pos: [p.pos![0] + 6, p.pos![1], p.pos![2] + 4] as [number, number, number] })),
    ],
  })
  list.push({ name: 'packs/hoard', size: P, parts: [...pile(34, 10, 28, 0, 0.5), { vox: gem(), pos: [0, 6.5, 0], rot: [0.15, 0.6, -0.1], scale: 0.7 }] })
  list.push({
    name: 'packs/trove',
    size: P,
    parts: [
      { vox: chestBody(EPIC, 7), scale: 1.05 },
      { vox: chestLid(EPIC), pos: [0, 9.4, -6.3], rot: [-1.2, 0, 0], scale: 1.05 },
      ...pile(22, 5.8, 8, 8.3, 0.46),
      ...pile(14, 9, 14, -0.8, 0.42).map((p) => ({ ...p, pos: [p.pos![0], p.pos![1], p.pos![2] + 9] as [number, number, number] })),
    ],
  })
  list.push({
    name: 'packs/treasury',
    size: P,
    parts: [
      { vox: goldBar(), pos: [-9, 0, 4] },
      { vox: goldBar(), pos: [-9, 0, 8.5] },
      { vox: goldBar(), pos: [-9, 3, 6.2], rot: [0, 0.1, 0] },
      { vox: goldBar(), pos: [9, 0, 6], rot: [0, -0.4, 0] },
      ...pile(30, 9, 22, 0, 0.5),
      { vox: gem(), pos: [0, 5.5, 1], rot: [0.1, 0.5, 0], scale: 0.85 },
      { vox: gem(), pos: [-6, 6.4, 6], rot: [0.3, 1.3, 0.2], scale: 0.55 },
    ],
  })
  list.push({
    name: 'packs/vault',
    size: P,
    parts: [
      { vox: vault(), pos: [0, 0, -6] },
      ...pile(26, 8, 18, 0, 0.5).map((p) => ({ ...p, pos: [p.pos![0], p.pos![1], p.pos![2] + 7] as [number, number, number] })),
      { vox: goldBar(), pos: [-9, 0, 9], rot: [0, 0.5, 0] },
      { vox: goldBar(), pos: [9, 0, 10], rot: [0, -0.6, 0] },
      { vox: gem(), pos: [0, 4.6, 9], rot: [0.2, 0.7, 0], scale: 0.7 },
    ],
  })
  list.push({
    name: 'packs/starter',
    size: P,
    parts: [
      { vox: giftBox(), pos: [0, 0, -2] },
      { vox: giftLid(), pos: [-4, 12.5, -6], rot: [-0.5, 0.3, 0.35] },
      ...pile(8, 3.6, 3, 9.6, 0.5),
      { vox: gem(), pos: [0, 12.2, -1], rot: [0.15, 0.6, -0.1], scale: 0.62 },
      ...pile(10, 7, 6, -0.5, 0.45).map((p) => ({ ...p, pos: [p.pos![0] + 3, p.pos![1], p.pos![2] + 9] as [number, number, number] })),
    ],
  })
  return list
}

/* ---------- Рендер ---------- */

const box = new THREE.BoxGeometry(1, 1, 1)
const mats = new Map<string, THREE.MeshStandardMaterial>()
function mat(c: string) {
  let m = mats.get(c)
  if (!m) {
    const col = new THREE.Color(c)
    const hsl = { h: 0, s: 0, l: 0 }
    col.getHSL(hsl)
    // Камни чуть светятся сами и блестят; дерево и кожа матовые.
    const gemish = hsl.s > 0.55 && (hsl.h > 0.9 || hsl.h < 0.03 || (hsl.h > 0.5 && hsl.h < 0.65))
    m = new THREE.MeshStandardMaterial({
      color: col,
      roughness: gemish ? 0.28 : 0.75,
      metalness: c.toLowerCase().startsWith('#e8b9') || c.toLowerCase().startsWith('#ffd5') ? 0.35 : 0.04,
      emissive: col.clone().multiplyScalar(gemish ? 0.08 : 0.03),
    })
    mats.set(c, m)
  }
  return m
}

function build(parts: Part[]): THREE.Group {
  const root = new THREE.Group()
  for (const p of parts) {
    const g = new THREE.Group()
    for (const [x, y, z, c] of p.vox) {
      const m = new THREE.Mesh(box, mat(c))
      m.position.set(x, y, z)
      g.add(m)
    }
    if (p.rot) g.rotation.set(p.rot[0], p.rot[1], p.rot[2])
    if (p.scale) g.scale.setScalar(p.scale)
    if (p.pos) g.position.set(p.pos[0], p.pos[1], p.pos[2])
    root.add(g)
  }
  return root
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(0x000000, 0)

function shoot(s: Scene): string {
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xfff4e8, 0.95))
  const key = new THREE.DirectionalLight(0xffffff, 2.6)
  key.position.set(-20, 40, 30)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.3)
  rim.position.set(30, 18, -30)
  scene.add(rim)
  const fill = new THREE.HemisphereLight(0xffffff, 0x3a2030, 0.6)
  scene.add(fill)
  const obj = build(s.parts)
  obj.rotation.y = s.yaw ?? 0.55
  scene.add(obj)
  const pitch = s.pitch ?? 0.42
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 2000)
  const bb = new THREE.Box3().setFromObject(obj)
  const c = bb.getCenter(new THREE.Vector3())
  const sz = bb.getSize(new THREE.Vector3())
  const R = Math.max(sz.x, sz.y, sz.z) * 0.62 * (s.zoom ? 1 / s.zoom : 1)
  const dist = R / Math.tan((26 / 2) * (Math.PI / 180))
  cam.position.set(c.x, c.y + Math.sin(pitch) * dist, c.z + Math.cos(pitch) * dist)
  cam.lookAt(c)
  // Дотянуть кадр: проекция угловых точек → поле кадра 92%.
  cam.updateMatrixWorld()
  let m = 0
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
    const v = new THREE.Vector3(x, y, z).project(cam)
    m = Math.max(m, Math.abs(v.x), Math.abs(v.y))
  }
  cam.position.sub(c).multiplyScalar(m / 0.9).add(c)
  cam.lookAt(c)
  const px = s.size
  renderer.setPixelRatio(1)
  renderer.setSize(px, px, false)
  renderer.render(scene, cam)
  return outline(renderer.domElement, s.outline ?? Math.max(2, Math.round(px / 96)))
}

/** Тёмная ступенчатая обводка силуэта — читается на любом фоне. */
function outline(src: HTMLCanvasElement, w: number): string {
  const n = src.width
  const cv = document.createElement('canvas')
  cv.width = n
  cv.height = n
  const g = cv.getContext('2d')!
  const tint = document.createElement('canvas')
  tint.width = n
  tint.height = n
  const t = tint.getContext('2d')!
  t.drawImage(src, 0, 0)
  t.globalCompositeOperation = 'source-in'
  t.fillStyle = '#12080c'
  t.fillRect(0, 0, n, n)
  for (let dx = -w; dx <= w; dx++) for (let dy = -w; dy <= w; dy++) if (dx * dx + dy * dy <= w * w + 1) g.drawImage(tint, dx, dy)
  // Жёсткая «подошва» на клетку ниже.
  g.globalAlpha = 0.5
  g.drawImage(tint, 0, w * 2)
  g.globalAlpha = 1
  g.drawImage(src, 0, 0)
  return cv.toDataURL('image/png')
}

const art: Record<string, string> = {}
const out = document.getElementById('out')!
const only = new URLSearchParams(location.search).get('only')
for (const s of scenes().filter((x) => !only || x.name.includes(only))) {
  art[s.name] = shoot(s)
  const f = document.createElement('figure')
  f.innerHTML = '<img width="' + (s.size / 2) + '" src="' + art[s.name] + '"><figcaption>' + s.name + '</figcaption>'
  out.appendChild(f)
}
;(window as unknown as { __art: Record<string, string> }).__art = art
