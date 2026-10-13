import { hydratePrefs, readPref, writePref } from './prefs'
import { createStyleNode } from './style-node'

const STYLE_ID = 'm-accent-css'

const VARS = [
  '--m-accent',
  '--m-accent-hover',
  '--m-accent-soft',
  '--m-accent-fg',
  '--m-accent-rgb',
  '--m-accent-base',
  '--m-grad',
] as const

export interface AccentVars {
  c: string
  h: string
  s: string
  fg?: string
  textC?: string
  rgb?: string
  grad?: string
}

export interface Accent extends AccentVars {
  id: string
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0x5ec64d
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toHex(r: number, g: number, b: number) {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b)
}

export function shade(hex: string, amt: number) {
  const { r, g, b } = hexToRgb(hex)
  const t = amt < 0 ? 0 : 255
  const p = Math.abs(amt)
  return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p)
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const UI_BACKGROUND = '#161718'
/// The darkest stock swatch sits at 3.87 against the window background: a colour
/// of the player's own is held to the same line, so no stock colour moves.
const MIN_UI_CONTRAST = 3.8
/// A colour that fails the line is raised to where the middle of the stock
/// palette sits: the kit prints dark ink on every accent fill, and it needs a
/// fill that bright to read.
const RAISED_UI_CONTRAST = 5.5

function contrast(a: string, b: string) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function toHsl(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r / 255 ? ((g - b) / 255 / d + 6) % 6 : max === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4
  return { h: h * 60, s, l }
}

function fromHsl(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export const readsOnUi = (hex: string) => contrast(hex, UI_BACKGROUND) >= MIN_UI_CONTRAST

/// The same hue and saturation, raised until it reads on the dark window:
/// buttons, links and marks all draw with this one colour.
export function readableOnUi(hex: string): string {
  if (readsOnUi(hex)) return hex
  const { h, s, l } = toHsl(hex)
  let dark = l
  let light = 1
  for (let step = 0; step < 14; step++) {
    const mid = (dark + light) / 2
    if (contrast(fromHsl(h, s, mid), UI_BACKGROUND) >= RAISED_UI_CONTRAST) light = mid
    else dark = mid
  }
  return fromHsl(h, s, light)
}

/// Достраивает акцент по базовому цвету: контрастный текст на заливке, читаемый
/// цвет самого акцента, градиент и rgb для свечения. Слишком тёмный цвет остаётся
/// цветом сцены (`c`), а кнопки и текст берут его читаемый оттенок.
export function computeAccent(a: Accent): Accent {
  const ui = readableOnUi(a.c)
  const tone = ui === a.c ? a : accentFromHex(ui)
  const { r, g, b } = hexToRgb(ui)
  return {
    ...a,
    h: tone.h,
    s: tone.s,
    fg: luminance(ui) > 0.5 ? '#141414' : '#ffffff',
    textC: ui,
    grad: 'linear-gradient(45deg,' + shade(ui, -0.16) + ' 0%,' + ui + ' 100%)',
    rgb: r + ',' + g + ',' + b,
  }
}

/// Из одного цвета — полный набор: наведение светлее на 18%, мягкая заливка той
/// же краской с прозрачностью.
export function accentFromHex(hex: string): Accent {
  const { r, g, b } = hexToRgb(hex)
  const lift = (v: number) => Math.round(v + (255 - v) * 0.18)
  return {
    id: 'custom',
    c: toHex(r, g, b),
    h: toHex(lift(r), lift(g), lift(b)),
    s: `rgba(${r},${g},${b},.14)`,
  }
}

let styleEl: HTMLStyleElement | null = null

function node(): HTMLStyleElement {
  if (styleEl && styleEl.isConnected) return styleEl
  const found = document.getElementById(STYLE_ID)
  styleEl = found instanceof HTMLStyleElement ? found : createStyleNode(STYLE_ID)
  styleEl.id = STYLE_ID
  // `:root:root` outranks the plain `:root` palette in the kit wherever the
  // style node lands in <head>.
  if (!styleEl.isConnected) document.head.appendChild(styleEl)
  return styleEl
}

/// The stored accent comes back through web storage, so it is built into a rule
/// through a style object: the engine parses every value and drops what it does
/// not understand, which no hand-written escape of the same text would match.
function declarations(a: AccentVars): string {
  const probe = document.createElement('div')
  const set = (k: (typeof VARS)[number], v: string | undefined) => {
    if (v) probe.style.setProperty(k, v)
  }
  set('--m-accent', a.textC || a.c)
  set('--m-accent-hover', a.h)
  set('--m-accent-soft', a.s)
  set('--m-accent-fg', a.fg || '#ffffff')
  set('--m-accent-rgb', a.rgb)
  set('--m-accent-base', a.c)
  set('--m-grad', a.grad)
  return probe.style.cssText
}

/// `boot.js` paints the accent inline on `<html>` before any app stylesheet
/// exists; once the kit is loaded the same values move into a rule.
export const ACCENT_EVENT = 'm-accent-change'

/** Базовый цвет акцента как #rrggbb — от него строятся фон лобби и волна. */
export function accentBase(): string {
  const style = getComputedStyle(document.documentElement)
  const picked = /^#[0-9a-f]{6}$/i.exec(style.getPropertyValue('--m-accent-base').trim())
  if (picked) return picked[0].toLowerCase()
  const m = /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(style.getPropertyValue('--m-accent-rgb').trim())
  return m ? toHex(+m[1], +m[2], +m[3]) : '#5ec64d'
}

export interface AccentChange {
  color: string
  settled: boolean
}

export function paintAccent(a: AccentVars, settled = false) {
  const inline = document.documentElement.style
  for (const v of VARS) inline.removeProperty(v)
  node().textContent = ':root:root{' + declarations(a) + '}'
  // Фон лобби и волна перехода перекрашиваются вслед (правка владельца 23.09.2026).
  window.dispatchEvent(new CustomEvent<AccentChange>(ACCENT_EVENT, { detail: { color: a.c, settled } }))
}

const ACCENT_KEY = 'm-accent'
const ACCENT_MAX = 256

export function saveAccent(a: AccentVars) {
  const json = JSON.stringify(a)
  if (json.length <= ACCENT_MAX) writePref(ACCENT_KEY, json)
  else
    try {
      localStorage.setItem(ACCENT_KEY, json)
    } catch {}
}

function paintStored(): boolean {
  try {
    const stored = JSON.parse(readPref(ACCENT_KEY, '') || 'null')
    if (stored && typeof stored === 'object' && typeof stored.c === 'string') {
      const kept = stored as Accent
      const accent = readsOnUi(kept.c) ? kept : computeAccent(kept)
      paintAccent(accent)
      if (accent.textC !== kept.textC) saveAccent(accent)
      return true
    }
  } catch {}
  return false
}

/// Web storage can start empty
/// while the durable copy still holds it, so the paint runs again once that copy
/// has landed. Until then the inline values `boot.js` wrote stay in place.
export async function initAccent(): Promise<void> {
  if (!paintStored()) for (const v of VARS) document.documentElement.style.removeProperty(v)
  await hydratePrefs()
  paintStored()
}

const PAINT_MS = 320
let paintTimer: ReturnType<typeof setTimeout> | undefined

/// Colours live in CSS variables, and a variable swap repaints instantly. The
/// class turns on a blanket colour transition only while the accent changes, so
/// nothing pays for it during normal use.
export function withColorFade(change: () => void) {
  const root = document.documentElement
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change()
    return
  }
  root.classList.add('color-fade')
  // A transition only starts when the declaration that carries it was already in
  // effect on the previous computed style: the flush gives it a "before".
  void root.offsetWidth
  change()
  clearTimeout(paintTimer)
  paintTimer = setTimeout(() => root.classList.remove('color-fade'), PAINT_MS)
}
