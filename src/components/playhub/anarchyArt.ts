const svgUrl = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)

/** A Minecraft player render in the lava palette; it stands for the server on every card. */
export const ANARCHY_HERO = '/lobby/anarchy-hero@2x.webp'

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

/**
 * Obsidian wall over a lava edge, 64x36 cells, 16:9: the backdrop the player
 * render stands on wherever the card has no room for motion.
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
  ]
  return svgUrl(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid slice">' +
      parts.join('') +
      '</svg>',
  )
})()
