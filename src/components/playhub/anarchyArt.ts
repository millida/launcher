type Rgb = readonly [number, number, number]

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]
const hex = (n: number) => n.toString(16).padStart(2, '0')
const rgb = ([r, g, b]: Rgb) => '#' + hex(r) + hex(g) + hex(b)
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as unknown as Rgb

export const svgUrl = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)

function runs(rows: readonly string[], palette: Record<string, string>, dx = 0, dy = 0): string {
  const out: string[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]!
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      const fill = palette[ch]
      if (fill) out.push('<rect x="' + (x + dx) + '" y="' + (y + dy) + '" width="' + (end - x) + '" height="1" fill="' + fill + '"/>')
      x = end
    }
  })
  return out.join('')
}

export interface Sprite {
  w: number
  h: number
  body: string
}

function sprite(rows: readonly string[], palette: Record<string, string>): Sprite {
  return { w: Math.max(...rows.map((r) => r.length)), h: rows.length, body: runs(rows, palette) }
}

const svgOf = (s: Sprite) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s.w + ' ' + s.h + '" shape-rendering="crispEdges">' + s.body + '</svg>'

const shades = (base: Rgb, dark: number, light: number, mid: number) => ({
  o: rgb(mix(base, BLACK, dark)),
  a: rgb(base),
  h: rgb(mix(base, WHITE, light)),
  s: rgb(mix(base, BLACK, mid)),
})

const CHESTPLATE = [
  '................',
  '..oooo....oooo..',
  '.ohhao....oahho.',
  '.ohaaooooooaaso.',
  '.oaaaahhhhaaaso.',
  '.osaaaaaaaaasso.',
  '..ooaaaaaaaaoo..',
  '...oattttttao...',
  '...ohaaaaaaso...',
  '...ohaaaaaaso...',
  '...oaaaaaaaso...',
  '...oattttttso...',
  '...ohaaaaasso...',
  '...oooooooooo...',
]

const CHEST = [
  '................',
  '.oooooooooooooo.',
  '.ohhhhhhhhhhhao.',
  '.ohaaaaaaaaaaso.',
  '.ohaaaaaaaaaaso.',
  '.ossssskkssssso.',
  '.oooooKkkKooooo.',
  '.ohaaaKkkKaaaso.',
  '.ohaaaakkaaaaso.',
  '.ohaaaaaaaaaaso.',
  '.ohaaaaaaaaaaso.',
  '.ohaaaaaaaaaaso.',
  '.osssssssssssso.',
  '.oooooooooooooo.',
]

const SHARD = [
  '..........oo',
  '.........ohho',
  '........ohhao',
  '.......ohaaso',
  '......ohaaso.',
  '.....ohaaso..',
  '....ohaaso...',
  '...ohaaso....',
  '..ohaaso.....',
  '.ohaaso......',
  '.oasso.......',
  '..oo.........',
]

const KEY = [
  '..oooo..........',
  '.ohhhao.........',
  'ohaooaso........',
  'ohao.oaoooooooo.',
  'ohaooahhhhhhhhso',
  '.oaaasoooooosso.',
  '..oooo.....oso..',
  '...........oo...',
]

const DROP = [
  '.......oo.......',
  '......ohso......',
  '......ohso......',
  '.....ohhaso.....',
  'oooooohaasoooooo',
  'ohhhhhhaaaaaasso',
  '.ohhaaaaaaaaaso.',
  '..ohaaaaaaaaso..',
  '...ohaaaaaaso...',
  '...ohaaaaaaso...',
  '..ohaaaooaaaso..',
  '..ohaasoohaaso..',
  '.ohaaso..ohaaso.',
  '.ohaso....ohaso.',
  '.oso........oso.',
  '.oo..........oo.',
]

const chestplate = (base: Rgb, trim: Rgb) => sprite(CHESTPLATE, { ...shades(base, 0.62, 0.42, 0.28), t: rgb(trim) })
const chest = (base: Rgb, lock: Rgb) =>
  sprite(CHEST, { ...shades(base, 0.66, 0.38, 0.3), k: rgb(lock), K: rgb(mix(lock, BLACK, 0.45)) })
const shard = (base: Rgb) => sprite(SHARD, shades(base, 0.6, 0.55, 0.25))
const key = (base: Rgb) => sprite(KEY, shades(base, 0.62, 0.45, 0.28))
const drop = (base: Rgb) => sprite(DROP, shades(base, 0.62, 0.55, 0.25))

const SPRITES = {
  plateEpic: chestplate([255, 74, 237], [196, 140, 255]),
  plateRed: chestplate([255, 74, 74], [176, 22, 22]),
  chest: chest([196, 104, 240], [255, 214, 92]),
  shard: shard([208, 112, 255]),
  key: key([255, 201, 58]),
  drop: drop([255, 201, 58]),
}

export type AnarchySprite = keyof typeof SPRITES

export const ANARCHY_SPRITES: Record<AnarchySprite, { url: string; w: number; h: number }> = Object.fromEntries(
  Object.entries(SPRITES).map(([k, s]) => [k, { url: svgUrl(svgOf(s)), w: s.w, h: s.h }]),
) as Record<AnarchySprite, { url: string; w: number; h: number }>

function noise(x: number, y: number, seed: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453
  return v - Math.floor(v)
}

const OBSIDIAN = ['#140910', '#170b12', '#1c0f17', '#211320']
const OBSIDIAN_VEIN = ['#3a1630', '#4a1b33', '#2f1440']

function obsidianBody(size: number, dx = 0, dy = 0): string {
  const out: string[] = []
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = noise(x, y, 7)
      const vein = noise(x >> 1, y >> 1, 3) > 0.86
      const fill = vein ? OBSIDIAN_VEIN[Math.floor(n * OBSIDIAN_VEIN.length)]! : OBSIDIAN[Math.floor(n * OBSIDIAN.length)]!
      out.push('<rect x="' + (x + dx) + '" y="' + (y + dy) + '" width="1" height="1" fill="' + fill + '"/>')
    }
  return out.join('')
}

/** One 16x16 obsidian block, tiled across the tile as its background. */
export const OBSIDIAN_TILE = svgUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">' + obsidianBody(16) + '</svg>',
)

const LAVA = ['#ff7a1a', '#e8423a', '#ffb21e', '#d9361d']

function lavaBody(w: number, h: number, dy: number): string {
  const out: string[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const n = noise(x, y, 11)
      const fill = y === 0 && n > 0.55 ? '#ffd27a' : LAVA[Math.floor(n * LAVA.length)]!
      out.push('<rect x="' + x + '" y="' + (y + dy) + '" width="1" height="1" fill="' + fill + '"/>')
    }
  return out.join('')
}

/** A 32x4 strip of lava cells; it repeats seamlessly along x. */
export const LAVA_STRIP = svgUrl(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 4" shape-rendering="crispEdges">' + lavaBody(32, 4, 0) + '</svg>',
)

const place = (s: Sprite, x: number, y: number, k: number) =>
  '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')">' + s.body + '</g>'

/**
 * Still art for places with no room for motion: the lobby plaque, the card in
 * "Рекомендуем" and the lobby recommendation. 64x36 cells, 16:9.
 */
export const ANARCHY_BANNER = (() => {
  const W = 64
  const H = 36
  const parts = [
    '<defs><pattern id="o" width="16" height="16" patternUnits="userSpaceOnUse">' + obsidianBody(16) + '</pattern>',
    '<pattern id="l" width="32" height="5" patternUnits="userSpaceOnUse">' + lavaBody(32, 5, 0) + '</pattern></defs>',
    '<rect width="' + W + '" height="' + H + '" fill="url(#o)"/>',
    '<rect y="24" width="' + W + '" height="4" fill="#ff5c24" opacity="0.12"/>',
    '<rect y="28" width="' + W + '" height="3" fill="#ff5c24" opacity="0.22"/>',
    '<g transform="translate(0 31)"><rect width="' + W + '" height="5" fill="url(#l)"/></g>',
    place(SPRITES.plateEpic, 22, 6, 1.25),
    place(SPRITES.chest, 4, 15, 0.75),
    place(SPRITES.drop, 47, 4, 0.8),
    place(SPRITES.shard, 50, 20, 0.6),
  ]
  return svgUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid slice">' +
      parts.join('') +
      '</svg>',
  )
})()
