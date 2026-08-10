import { hydratePrefs, readPref, writePref } from './prefs'

const STYLE_ID = 'm-accent-css'
const PACK_STYLE_ID = 'm-theme-pack-css'

const VARS = [
  '--m-accent',
  '--m-accent-hover',
  '--m-accent-soft',
  '--m-accent-fg',
  '--m-accent-rgb',
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

function shade(hex: string, amt: number) {
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

/// Достраивает акцент по базовому цвету: контрастный текст на заливке, читаемый
/// цвет самого акцента на светлом фоне, градиент и rgb для свечения. Одна
/// реализация на всё приложение — палитра в настройках и тема из редактора
/// обязаны считать эти значения одинаково.
export function computeAccent(a: Accent): Accent {
  const lum = luminance(a.c)
  const { r, g, b } = hexToRgb(a.c)
  return {
    ...a,
    fg: lum > 0.5 ? '#141414' : '#ffffff',
    textC: lum > 0.6 ? shade(a.c, -0.42) : a.c,
    grad: 'linear-gradient(45deg,' + shade(a.c, -0.16) + ' 0%,' + a.c + ' 100%)',
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
  styleEl = found instanceof HTMLStyleElement ? found : document.createElement('style')
  styleEl.id = STYLE_ID
  // `:root:root` and a pack's `:root[data-theme-pack=…]` weigh the same, so the
  // pack only wins while it is written later. It also has to stay ahead of the
  // light palette, which is why the doubled selector is there at all.
  if (!styleEl.isConnected) {
    const pack = document.getElementById(PACK_STYLE_ID)
    if (pack) document.head.insertBefore(styleEl, pack)
    else document.head.appendChild(styleEl)
  }
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
  set('--m-grad', a.grad)
  return probe.style.cssText
}

/// `boot.js` paints the accent inline on `<html>` before any app stylesheet
/// exists, and an inline declaration outranks every rule a theme pack can write
/// — a pack's own accent was silently lost for anyone who had ever picked a
/// colour. Once the kit is loaded the same values move into a rule, so a pack
/// wins while a pack that leaves the accent alone still shows the user's colour.
export function paintAccent(a: AccentVars) {
  const inline = document.documentElement.style
  for (const v of VARS) inline.removeProperty(v)
  node().textContent = ':root:root{' + declarations(a) + '}'
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
      paintAccent(stored as AccentVars)
      return true
    }
  } catch {}
  return false
}

/// The accent shares the fate of the theme pack: web storage can start empty
/// while the durable copy still holds it, so the paint runs again once that copy
/// has landed. Until then the inline values `boot.js` wrote stay in place.
export async function initAccent(): Promise<void> {
  if (!paintStored()) for (const v of VARS) document.documentElement.style.removeProperty(v)
  await hydratePrefs()
  paintStored()
}
