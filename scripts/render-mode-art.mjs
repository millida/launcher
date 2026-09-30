/**
 * Рендер значков режимов (`scripts/mode-icons.mjs`) в PNG — для лаунчера и
 * для millida.net/katalog одним заходом, без браузера и без зависимостей:
 *
 *   node scripts/render-mode-art.mjs public/mode-art [../site/public/catalog-art/modes] [--manifest ../site/src/lib/catalog-mode-art.json]
 *
 * В каждую папку пишутся `<CODE>.png` — значок 16×16 с контуром (растягивается
 * целым шагом, image-rendering: pixelated) и `<CODE>-bg.png` — фон плитки:
 * мозаика 12×12 клеток цвета режима со ступенчатым светом вокруг значка, как
 * у плиток Blups. Манифест — название, цвет и размер значка по коду.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { MODE_ICONS, OUTLINE, PAL } from './mode-icons.mjs'

const args = process.argv.slice(2)
const mi = args.indexOf('--manifest')
const manifestPath = mi >= 0 ? resolve(args[mi + 1]) : null
const dirs = args.filter((_, i) => mi < 0 || (i !== mi && i !== mi + 1)).map((d) => resolve(d))
if (!dirs.length) {
  console.error('usage: node scripts/render-mode-art.mjs <out-dir> [more dirs] [--manifest file.json]')
  process.exit(1)
}

/* ---------- PNG ---------- */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** @param {number} w @param {number} h @param {Uint8Array} rgba */
export function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------- цвет ---------- */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
function rgbToHsl([r, g, b]) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255))
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255))
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/* ---------- значок ---------- */
export const ICON = 16
export function renderIcon(rows, code) {
  if (rows.length !== ICON || rows.some((r) => r.length !== ICON)) throw new Error(code + ': значок должен быть 16×16')
  const px = new Uint8Array(ICON * ICON * 4)
  const filled = (x, y) => x >= 0 && y >= 0 && x < ICON && y < ICON && rows[y][x] !== '.'
  const out = hex(OUTLINE)
  for (let y = 0; y < ICON; y++)
    for (let x = 0; x < ICON; x++) {
      const ch = rows[y][x]
      let c = null
      if (ch !== '.') {
        if (!PAL[ch]) throw new Error(code + ': нет цвета «' + ch + '»')
        c = hex(PAL[ch])
      } else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) c = out
      if (!c) continue
      const i = (y * ICON + x) * 4
      px.set([...c, 255], i)
    }
  return px
}

/* ---------- фон ---------- */
export const BG = 12
function noise(x, y, seed) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453
  return v - Math.floor(v)
}
export function renderBg(color, seed) {
  const [h, s, l] = rgbToHsl(hex(color))
  const px = new Uint8Array(BG * BG * 4)
  // Свет стоит чуть выше середины — там, где значок (подпись внизу плитки).
  const cx = (BG - 1) / 2
  const cy = BG * 0.4
  for (let y = 0; y < BG; y++)
    for (let x = 0; x < BG; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.05)
      const glow = d < 2.6 ? 0.13 : d < 4.1 ? 0.07 : d < 5.6 ? 0.025 : -0.02
      const jitter = [-0.035, -0.018, 0, 0, 0.018, 0.03][Math.floor(noise(x, y, seed) * 6)]
      const ll = clamp(Math.min(l, 0.5) + glow + jitter, 0.12, 0.8)
      px.set([...hslToRgb([h, clamp(s, 0.45, 0.85), ll]), 255], (y * BG + x) * 4)
    }
  return px
}

const manifest = {}
const codes = Object.keys(MODE_ICONS)
for (const dir of dirs) mkdirSync(dir, { recursive: true })
codes.forEach((code, i) => {
  const m = MODE_ICONS[code]
  const icon = png(ICON, ICON, renderIcon(m.rows, code))
  const bg = png(BG, BG, renderBg(m.color, i + 1))
  for (const dir of dirs) {
    writeFileSync(join(dir, code + '.png'), icon)
    writeFileSync(join(dir, code + '-bg.png'), bg)
  }
  manifest[code] = { title: m.title, color: m.color, w: ICON, h: ICON }
})
for (const dir of dirs) writeFileSync(join(dir, 'modes.json'), JSON.stringify(manifest, null, 2) + '\n')
if (manifestPath) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('modes:', codes.length, '→', dirs.join(', '))
