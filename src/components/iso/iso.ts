/**
 * Изометрические пиксельные сцены из блоков Minecraft — для живого OneBlock
 * в лобби и плиток режимов (правка владельца 23.09.2026, 23:00: «с OneBlock
 * охуительно — сделай так же со всеми остальными, мобы, риги»).
 *
 * Всё рисуется кодом, без чужих текстур: грань 16×16 текселей собирается из
 * палитры и детерминированного шума. Грани растеризуются вручную попиксельно
 * (обратное отображение в тексель), а не drawImage с перекосом: так нет
 * сглаженных краёв и щелей между гранями, и WebKit рисует так же, как Chrome.
 *
 * Проекция 2:1, как иконки блоков в инвентаре: блок с ребром 16 текселей —
 * ромб 32×16 сверху и две боковые грани 16×16. Видимые грани: верх (свет 1.0),
 * левая (+z, 0.8), правая (+x, 0.62). Голова моба смотрит влево — лицо на +z.
 */

type Rgb = [number, number, number]
type Tex = Uint8ClampedArray // 16×16×3
type Pix = (x: number, y: number) => string

const hex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hash(x: number, y: number, s: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453
  return v - Math.floor(v)
}
const pick = (pal: string[], x: number, y: number, s: number) => pal[Math.floor(hash(x, y, s) * pal.length)]!

function tex(f: Pix): Tex {
  const t = new Uint8ClampedArray(16 * 16 * 3)
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [r, g, b] = hex(f(x, y))
      const i = (y * 16 + x) * 3
      t[i] = r
      t[i + 1] = g
      t[i + 2] = b
    }
  return t
}

/** Лицо моба 8×8: буква — цвет палитры; растягивается вдвое до 16×16. */
function face8(rows: string[], pal: Record<string, string[]>, seed: number): Pix {
  return (x, y) => {
    const ch = rows[y >> 1]![x >> 1]!
    return pick(pal[ch]!, x >> 1, y >> 1, seed)
  }
}

/* ---------- палитры ---------- */
const GRASS = ['#5fa83a', '#6fbf45', '#4f9530', '#7ccb52', '#67b33f']
const DIRT = ['#8a5a36', '#7a4e2d', '#9b6a42', '#6b4426']
const STONE = ['#7f7f7f', '#8e8e8e', '#737373', '#999999', '#858585']
const PLANK = ['#b0864d', '#a27a44', '#bd9257', '#9a7040']
const BARK = ['#6b5030', '#5a4226', '#77593a']
const LEAF = ['#3f8f2a', '#347d22', '#4c9e34', '#2c6c1c']
const SAND = ['#dcd3a1', '#e6ddb0', '#cfc591', '#d7cc98']
const OBSID = ['#150f22', '#1f1531', '#2b1f46', '#0f0a18']
const NETHER = ['#7a2323', '#8e2b2b', '#6b1c1c', '#9a3a33']
const SNOW = ['#f2f6fa', '#e6edf3', '#ffffff', '#dfe7ee']

const ore = (spot: string[]): Pix => (x, y) => {
  const cx = x >> 1
  const cy = y >> 1
  const on = hash(cx, cy, 91) > 0.74 && hash(x, y, 5) > 0.2
  return on ? pick(spot, x, y, 3) : pick(STONE, x, y, 1)
}
const metal = (pal: string[], edge: string, hi: string): Pix => (x, y) =>
  x === 0 || y === 0 ? hi : x === 15 || y === 15 ? edge : pick(pal, x, y, 4)
const wool = (pal: string[]): Pix => (x, y) => pick(pal, x, y + ((x * 3) % 5), 8)
const planks: Pix = (x, y) => {
  if (y % 4 === 3) return '#6f5030'
  const row = y >> 2
  const seam = (row % 2 ? 11 : 4) === x
  return seam ? '#7c5a35' : pick(PLANK, x, y, 6)
}
const bricks: Pix = (x, y) => {
  if (y % 4 === 3) return '#b8aca0'
  const row = y >> 2
  if ((x + (row % 2) * 4) % 8 === 7) return '#b8aca0'
  return pick(['#9c4a36', '#a8533d', '#8c412f', '#b25d45'], x, y, 7)
}
const cobble: Pix = (x, y) => {
  const cx = Math.floor((x + (y >> 2) % 2 * 2) / 4)
  const cy = y >> 2
  const edge = (x + (y >> 2) % 2 * 2) % 4 === 3 || y % 4 === 3
  return edge ? '#565656' : pick(STONE, cx * 7 + x, cy * 5 + y, 2)
}
const tntSide: Pix = (x, y) => {
  if (y >= 5 && y <= 10) {
    // Белая лента с буквами «TNT» 3×4 пикселя.
    const L = [
      '...............',
      '.TTT.N..N.TTT..',
      '..T..NN.N..T...',
      '..T..N.NN..T...',
      '..T..N..N..T...',
    ]
    const r = L[y - 5]
    const ch = r ? r[x] : '.'
    return ch && ch !== '.' ? '#1d1d1d' : y === 5 || y === 10 ? '#cfcfcf' : '#f2f2f2'
  }
  return x % 4 === 0 ? '#a11d14' : pick(['#db2f22', '#c9281c', '#e3452f'], x, y, 9)
}
const lucky: Pix = (x, y) => {
  if (x === 0 || y === 0 || x === 15 || y === 15) return '#8a5a00'
  const Q = ['.....', '.QQQ.', 'Q...Q', '...Q.', '..Q..', '.....', '..Q..']
  const r = Q[y - 4]
  const ch = r && x >= 5 && x <= 9 ? r[x - 5] : '.'
  return ch === 'Q' ? '#6b3f00' : pick(['#ffd23f', '#f5c518', '#ffdf66'], x, y, 11)
}
const chestSide: Pix = (x, y) => {
  if (x === 0 || x === 15 || y === 15 || y === 5) return '#3b2410'
  return pick(['#a86a2a', '#9a5f22', '#b67630'], x, y, 12)
}
const chestFront: Pix = (x, y) => (x >= 7 && x <= 8 && y >= 4 && y <= 7 ? '#c9c9c9' : chestSide(x, y))
const furnaceFront: Pix = (x, y) =>
  x >= 4 && x <= 11 && y >= 8 && y <= 13 ? (y >= 11 ? pick(['#ff8a1f', '#ffb13b', '#e0561a'], x, y, 3) : '#1c1c1c') : cobble(x, y)
const bookshelf: Pix = (x, y) => {
  if (y < 2 || y > 13 || y === 7 || y === 8) return planks(x, y)
  const book = ['#b0342a', '#2e5aa8', '#3c8a3a', '#c9a227', '#7a3fa0']
  return x % 3 === 2 ? '#3a2412' : book[Math.floor(hash(Math.floor(x / 3), y > 8 ? 1 : 0, 4) * book.length)]!
}
const glowstone: Pix = (x, y) => pick(['#ffd97a', '#f2b84a', '#fff0b0', '#c98a2e'], x >> 1, y >> 1, 13)

/* ---------- головы мобов ---------- */
const HEAD = {
  creeper: face8(
    ['gggggggg', 'gggggggg', 'gKKggKKg', 'gKKggKKg', 'gggKKggg', 'ggKKKKgg', 'ggKKKKgg', 'ggKggKgg'],
    { g: ['#5fbf4a', '#4fa83c', '#73cf5a', '#3f9130'], K: ['#101010', '#1c1c1c'] },
    21,
  ),
  creeperSide: (x: number, y: number) => pick(['#5fbf4a', '#4fa83c', '#73cf5a', '#3f9130'], x >> 1, y >> 1, 22),
  zombie: face8(
    ['hhhhhhhh', 'hggggggh', 'gggggggg', 'gKKggKKg', 'gggDDggg', 'ggDggDgg', 'gggggggg', 'gggggggg'],
    { g: ['#5a9a47', '#4e8a3d', '#679f52'], h: ['#2f5a24', '#3a6b2c'], K: ['#0e1e0c'], D: ['#3a6b2c'] },
    23,
  ),
  zombieSide: (x: number, y: number) => (y < 4 ? pick(['#2f5a24', '#3a6b2c'], x, y, 1) : pick(['#5a9a47', '#4e8a3d'], x >> 1, y >> 1, 24)),
  skeleton: face8(
    ['wwwwwwww', 'wwwwwwww', 'wwwwwwww', 'wKKwwKKw', 'wwwKKwww', 'wwwwwwww', 'wKKKKKKw', 'wwwwwwww'],
    { w: ['#cfcfcf', '#bdbdbd', '#dedede'], K: ['#2b2b2b', '#3a3a3a'] },
    25,
  ),
  skeletonSide: (x: number, y: number) => pick(['#cfcfcf', '#bdbdbd', '#dedede', '#b0b0b0'], x >> 1, y >> 1, 26),
  enderman: face8(
    ['kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', 'PpPkkPpP', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk'],
    { k: ['#141414', '#1d1d1d', '#0e0e0e'], P: ['#e079fa'], p: ['#cc00fa'] },
    27,
  ),
  endermanSide: (x: number, y: number) => pick(['#141414', '#1d1d1d', '#0e0e0e'], x >> 1, y >> 1, 28),
  steve: face8(
    ['hhhhhhhh', 'hhhhhhhh', 'hssssssh', 'ssssssss', 'sWBssBWs', 'sssNNsss', 'ssMMMMss', 'ssssssss'],
    { h: ['#3b2a1a', '#2e2012', '#46321f'], s: ['#c6865a', '#b8784e', '#d0936a'], W: ['#ffffff'], B: ['#4a3b9a'], N: ['#94573a'], M: ['#6b3a2a'] },
    29,
  ),
  steveSide: (x: number, y: number) => (y < 6 ? pick(['#3b2a1a', '#2e2012', '#46321f'], x, y, 1) : pick(['#c6865a', '#b8784e'], x >> 1, y >> 1, 30)),
  pig: face8(
    ['pppppppp', 'pppppppp', 'pWKppKWp', 'pppppppp', 'ppSSSSpp', 'ppSNNSpp', 'ppSSSSpp', 'pppppppp'],
    { p: ['#f0a5a2', '#e8948f', '#f5b3ae'], W: ['#ffffff'], K: ['#101010'], S: ['#e27b86', '#d86e7a'], N: ['#8a3a44'] },
    31,
  ),
  pigSide: (x: number, y: number) => pick(['#f0a5a2', '#e8948f', '#f5b3ae'], x >> 1, y >> 1, 32),
  villager: face8(
    ['ssssssss', 'ssssssss', 'sBBBBBBs', 'sWGssGWs', 'sssNNsss', 'sssNNsss', 'sssNNsss', 'ssssssss'],
    { s: ['#b98763', '#a97a58', '#c4926c'], B: ['#4a2e1c'], W: ['#ffffff'], G: ['#2f8f3a'], N: ['#a06a48'] },
    33,
  ),
  villagerSide: (x: number, y: number) => pick(['#b98763', '#a97a58', '#c4926c'], x >> 1, y >> 1, 34),
}

/* ---------- блоки ---------- */
interface BlockDef {
  top: Pix
  side: Pix
  /** Грань +z (слева на экране), если отличается: лицо моба, дверца. */
  front?: Pix
}

const B: Record<string, BlockDef> = {
  grass: {
    top: (x, y) => pick(GRASS, x, y, 1),
    side: (x, y) => (y < 3 || (y === 3 && hash(x, y, 2) > 0.45) ? pick(GRASS, x, y, 3) : pick(DIRT, x, y, 4)),
  },
  dirt: { top: (x, y) => pick(DIRT, x, y, 5), side: (x, y) => pick(DIRT, x, y, 6) },
  stone: { top: (x, y) => pick(STONE, x, y, 7), side: (x, y) => pick(STONE, x, y, 8) },
  cobble: { top: cobble, side: cobble },
  log: {
    top: (x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
      return d > 6.5 ? pick(BARK, x, y, 1) : Math.floor(d) % 2 ? '#b8935a' : '#c9a468'
    },
    side: (x, y) => (x % 4 === 1 ? '#4a3620' : pick(BARK, x, y >> 1, 2)),
  },
  planks: { top: planks, side: planks },
  leaves: { top: (x, y) => pick(LEAF, x, y, 3), side: (x, y) => pick(LEAF, x, y, 4) },
  sand: { top: (x, y) => pick(SAND, x, y, 5), side: (x, y) => pick(SAND, x, y, 6) },
  gold_ore: { top: ore(['#fcee4b', '#e8c32a', '#fff38a']), side: ore(['#fcee4b', '#e8c32a', '#fff38a']) },
  diamond_ore: { top: ore(['#5decf5', '#2cc9d6', '#a8fbff']), side: ore(['#5decf5', '#2cc9d6', '#a8fbff']) },
  emerald_ore: { top: ore(['#41f384', '#17c35a', '#9dffc0']), side: ore(['#41f384', '#17c35a', '#9dffc0']) },
  iron_ore: { top: ore(['#d8af93', '#c49a7c', '#e8c7b0']), side: ore(['#d8af93', '#c49a7c', '#e8c7b0']) },
  redstone_ore: { top: ore(['#ff2a2a', '#c40000', '#ff7070']), side: ore(['#ff2a2a', '#c40000', '#ff7070']) },
  tnt: {
    top: (x, y) => (x >= 6 && x <= 9 && y >= 6 && y <= 9 ? '#3a3a3a' : pick(['#db2f22', '#c9281c'], x, y, 9)),
    side: tntSide,
  },
  obsidian: { top: (x, y) => pick(OBSID, x, y, 10), side: (x, y) => pick(OBSID, x, y, 11) },
  netherrack: { top: (x, y) => pick(NETHER, x, y, 12), side: (x, y) => pick(NETHER, x, y, 13) },
  snow: { top: (x, y) => pick(SNOW, x, y, 14), side: (x, y) => pick(SNOW, x, y, 15) },
  bricks: { top: bricks, side: bricks },
  lucky: { top: lucky, side: lucky },
  chest: { top: chestSide, side: chestSide, front: chestFront },
  furnace: { top: cobble, side: cobble, front: furnaceFront },
  bookshelf: { top: planks, side: bookshelf },
  glowstone: { top: glowstone, side: glowstone },
  gold_block: { top: metal(['#fcdc4b', '#f5cf33', '#ffe36e'], '#c28f00', '#fff2a8'), side: metal(['#fcdc4b', '#f5cf33', '#ffe36e'], '#c28f00', '#fff2a8') },
  iron_block: { top: metal(['#dcdcdc', '#d0d0d0', '#e8e8e8'], '#9a9a9a', '#ffffff'), side: metal(['#dcdcdc', '#d0d0d0', '#e8e8e8'], '#9a9a9a', '#ffffff') },
  diamond_block: { top: metal(['#62e8e0', '#4fd8d0', '#8ef3ee'], '#1f9a93', '#d0fffc'), side: metal(['#62e8e0', '#4fd8d0', '#8ef3ee'], '#1f9a93', '#d0fffc') },
  emerald_block: { top: metal(['#2ed26a', '#22bf5c', '#56e38a'], '#0f7a38', '#b6ffd0'), side: metal(['#2ed26a', '#22bf5c', '#56e38a'], '#0f7a38', '#b6ffd0') },
  redstone_block: { top: metal(['#c8190f', '#b3150c', '#dc2a1c'], '#6e0a05', '#ff6a5a'), side: metal(['#c8190f', '#b3150c', '#dc2a1c'], '#6e0a05', '#ff6a5a') },
  wool_red: { top: wool(['#b3312c', '#a52b26', '#c0403a']), side: wool(['#b3312c', '#a52b26', '#c0403a']) },
  wool_white: { top: wool(['#e9ecec', '#dcdfe0', '#f5f7f7']), side: wool(['#e9ecec', '#dcdfe0', '#f5f7f7']) },
  wool_blue: { top: wool(['#3c44aa', '#343b9a', '#4a53bb']), side: wool(['#3c44aa', '#343b9a', '#4a53bb']) },
  wool_yellow: { top: wool(['#f9c627', '#eab71c', '#ffd24a']), side: wool(['#f9c627', '#eab71c', '#ffd24a']) },
  wool_lime: { top: wool(['#70b919', '#63a813', '#80c92a']), side: wool(['#70b919', '#63a813', '#80c92a']) },
  wool_purple: { top: wool(['#8932b8', '#7a2aa6', '#9a44c8']), side: wool(['#8932b8', '#7a2aa6', '#9a44c8']) },
  wool_orange: { top: wool(['#f07613', '#e0690c', '#ff8a2a']), side: wool(['#f07613', '#e0690c', '#ff8a2a']) },
  wool_cyan: { top: wool(['#158991', '#117a82', '#1e9aa2']), side: wool(['#158991', '#117a82', '#1e9aa2']) },
  bed_foot: {
    top: wool(['#b3312c', '#a52b26', '#c0403a']),
    side: (x, y) => (y < 5 ? pick(['#b3312c', '#a52b26'], x, y, 1) : planks(x, y)),
  },
  bed_head: {
    top: (x, y) => (y >= 2 && y <= 9 && x >= 2 && x <= 13 ? pick(['#f5f7f7', '#e3e6e6'], x, y, 2) : pick(['#b3312c', '#a52b26'], x, y, 3)),
    side: (x, y) => (y < 5 ? pick(['#b3312c', '#a52b26'], x, y, 1) : planks(x, y)),
  },
  head_creeper: { top: HEAD.creeperSide, side: HEAD.creeperSide, front: HEAD.creeper },
  head_zombie: { top: HEAD.zombieSide, side: HEAD.zombieSide, front: HEAD.zombie },
  head_skeleton: { top: HEAD.skeletonSide, side: HEAD.skeletonSide, front: HEAD.skeleton },
  head_enderman: { top: HEAD.endermanSide, side: HEAD.endermanSide, front: HEAD.enderman },
  head_steve: { top: (x, y) => pick(['#3b2a1a', '#2e2012', '#46321f'], x, y, 1), side: HEAD.steveSide, front: HEAD.steve },
  head_pig: { top: HEAD.pigSide, side: HEAD.pigSide, front: HEAD.pig },
  head_villager: { top: HEAD.villagerSide, side: HEAD.villagerSide, front: HEAD.villager },
}

export type BlockName = keyof typeof B

interface Faces {
  top: Tex
  side: Tex
  front: Tex
}
const faceCache = new Map<string, Faces>()
function faces(name: string): Faces {
  const hit = faceCache.get(name)
  if (hit) return hit
  const d = B[name] || B.stone!
  const side = tex(d.side)
  const out = { top: tex(d.top), side, front: d.front ? tex(d.front) : side }
  faceCache.set(name, out)
  return out
}

/* ---------- сцена ---------- */

/** Куб: позиция в блоках (y — вверх), k — ребро в блоках (голова 0.5), h — доля высоты. */
export interface Cube {
  b: string
  x: number
  y: number
  z: number
  k?: number
  h?: number
}
/** Плоский значок, стоящий на точке: нижний центр — в (x, y, z); s — целый шаг пикселя. */
export interface Sprite {
  img: HTMLCanvasElement
  x: number
  y: number
  z: number
  s?: number
  /** Сдвиг вверх в пикселях: «воткнут» глубже или висит выше. */
  lift?: number
}
export type Item = Cube | Sprite

const isCube = (i: Item): i is Cube => 'b' in i

/** Экранная точка мировой (в пикселях при ребре 16). */
const scr = (x: number, y: number, z: number): [number, number] => [(x - z) * 16, (x + z) * 8 - y * 16]

interface Buf {
  w: number
  h: number
  d: Uint8ClampedArray<ArrayBuffer>
}

/** Растеризация грани-параллелограмма: O + u·U + v·V, u∈[0,16), v∈[0,vmax). */
function face(buf: Buf, ox: number, oy: number, U: [number, number], V: [number, number], t: Tex, vmax: number, light: number) {
  const det = U[0] * V[1] - U[1] * V[0]
  if (!det) return
  const xs = [ox, ox + U[0] * 16, ox + V[0] * vmax, ox + U[0] * 16 + V[0] * vmax]
  const ys = [oy, oy + U[1] * 16, oy + V[1] * vmax, oy + U[1] * 16 + V[1] * vmax]
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const x1 = Math.min(buf.w - 1, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const y1 = Math.min(buf.h - 1, Math.ceil(Math.max(...ys)))
  for (let py = y0; py <= y1; py++)
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - ox
      const dy = py + 0.5 - oy
      const u = (dx * V[1] - dy * V[0]) / det
      const v = (U[0] * dy - U[1] * dx) / det
      if (u < 0 || u >= 16 || v < 0 || v >= vmax) continue
      const ti = ((Math.floor(v) & 15) * 16 + (Math.floor(u) & 15)) * 3
      const i = (py * buf.w + px) * 4
      buf.d[i] = t[ti]! * light
      buf.d[i + 1] = t[ti + 1]! * light
      buf.d[i + 2] = t[ti + 2]! * light
      buf.d[i + 3] = 255
    }
}

function drawCube(buf: Buf, c: Cube, offX: number, offY: number) {
  const k = c.k ?? 1
  const h = c.h ?? 1
  const f = faces(c.b)
  const H = k * h
  const [tx, ty] = scr(c.x, c.y + H, c.z)
  // Верх: u вдоль +x, v вдоль +z.
  face(buf, tx + offX, ty + offY, [k, k / 2], [-k, k / 2], f.top, 16, 1)
  // Левая грань (+z): u вдоль +x, v вниз; высота h·16 текселей.
  const [lx, ly] = scr(c.x, c.y + H, c.z + k)
  face(buf, lx + offX, ly + offY, [k, k / 2], [0, k], f.front, 16 * h, 0.8)
  // Правая грань (+x): u вдоль −z слева направо.
  const [rx, ry] = scr(c.x + k, c.y + H, c.z + k)
  face(buf, rx + offX, ry + offY, [k, -k / 2], [0, k], f.side, 16 * h, 0.62)
}

function drawSprite(buf: Buf, s: Sprite, offX: number, offY: number) {
  const g = s.img.getContext('2d')
  if (!g) return
  const k = s.s ?? 1
  const w = s.img.width
  const h = s.img.height
  const src = g.getImageData(0, 0, w, h).data
  const [ax, ay] = scr(s.x, s.y, s.z)
  const left = Math.round(ax + offX - (w * k) / 2)
  const top = Math.round(ay + offY - h * k - (s.lift ?? 0))
  for (let y = 0; y < h * k; y++)
    for (let x = 0; x < w * k; x++) {
      const si = (Math.floor(y / k) * w + Math.floor(x / k)) * 4
      if (src[si + 3]! < 128) continue
      const px = left + x
      const py = top + y
      if (px < 0 || py < 0 || px >= buf.w || py >= buf.h) continue
      const i = (py * buf.w + px) * 4
      buf.d[i] = src[si]!
      buf.d[i + 1] = src[si + 1]!
      buf.d[i + 2] = src[si + 2]!
      buf.d[i + 3] = 255
    }
}

function bounds(items: Item[]): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  for (const it of items) {
    if (isCube(it)) {
      const k = it.k ?? 1
      const H = k * (it.h ?? 1)
      for (const [dx, dy, dz] of [
        [0, H, 0],
        [k, H, 0],
        [0, H, k],
        [k, 0, 0],
        [0, 0, k],
        [k, 0, k],
      ] as const) {
        const [sx, sy] = scr(it.x + dx, it.y + dy, it.z + dz)
        add(sx, sy)
      }
    } else {
      const k = it.s ?? 1
      const [ax, ay] = scr(it.x, it.y, it.z)
      add(ax - (it.img.width * k) / 2, ay - it.img.height * k - (it.lift ?? 0))
      add(ax + (it.img.width * k) / 2, ay)
    }
  }
  return [x0, y0, x1, y1]
}

/** Глубина: дальше — раньше. Центр по x+z, потом снизу вверх. */
function depth(it: Item): number {
  const k = isCube(it) ? (it.k ?? 1) : 0
  const c = it.x + it.z + k
  return c * 100 + it.y * 10 + (isCube(it) ? 0 : 5)
}

export interface Rendered {
  canvas: HTMLCanvasElement
  w: number
  h: number
  /** Куда попала мировая точка (0,0,0) — для наложений поверх. */
  ox: number
  oy: number
}

/**
 * Сцена в родном размере (1 пиксель = 1 тексель по ширине). Контур 1 px
 * тёмным по силуэту — как у предметов в инвентаре; тень снизу не рисуем,
 * её даёт CSS.
 */
export function renderScene(items: Item[], outline = '#1b1216', pad = 2): Rendered {
  const [x0, y0, x1, y1] = bounds(items)
  const w = Math.ceil(x1 - x0) + pad * 2
  const h = Math.ceil(y1 - y0) + pad * 2
  const offX = pad - Math.floor(x0)
  const offY = pad - Math.floor(y0)
  const buf: Buf = { w, h, d: new Uint8ClampedArray(new ArrayBuffer(w * h * 4)) }
  const order = [...items].sort((a, b) => depth(a) - depth(b))
  for (const it of order) {
    if (isCube(it)) drawCube(buf, it, offX, offY)
    else drawSprite(buf, it, offX, offY)
  }
  if (outline) {
    const [r, g, b] = hex(outline)
    const a = buf.d
    const was = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) was[i] = a[i * 4 + 3]! ? 1 : 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (was[y * w + x]) continue
        const n = (x > 0 && was[y * w + x - 1]) || (x < w - 1 && was[y * w + x + 1]) || (y > 0 && was[(y - 1) * w + x]) || (y < h - 1 && was[(y + 1) * w + x])
        if (!n) continue
        const i = (y * w + x) * 4
        a[i] = r
        a[i + 1] = g
        a[i + 2] = b
        a[i + 3] = 255
      }
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')?.putImageData(new ImageData(buf.d, w, h), 0, 0)
  return { canvas: c, w, h, ox: offX, oy: offY }
}

/** Средний цвет верхней грани блока — для осколков при разрушении. */
export function blockColors(name: string): string[] {
  const f = faces(name)
  const out: string[] = []
  for (let i = 0; i < 6; i++) {
    const ti = Math.floor(hash(i, 3, 7) * 256) * 3
    out.push('rgb(' + f.side[ti] + ',' + f.side[ti + 1] + ',' + f.side[ti + 2] + ')')
  }
  return out
}
