import { hydratePrefs, readPref, writePref } from './prefs'

export type ThemeId = '' | 'light' | 'auto'

const KEY = 'm-theme'

export function storedTheme(): ThemeId {
  const v = readPref(KEY, 'dark')
  return v === 'light' || v === 'auto' ? v : ''
}

const PAINT_MS = 320
let paintTimer: ReturnType<typeof setTimeout> | undefined

/// Colours live in CSS variables, and a variable swap repaints instantly. The
/// class turns on a blanket colour transition only while the palette changes, so
/// nothing pays for it during normal use.
export function withColorFade(change: () => void) {
  const root = document.documentElement
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change()
    return
  }
  root.classList.add('color-fade')
  change()
  clearTimeout(paintTimer)
  paintTimer = setTimeout(() => root.classList.remove('color-fade'), PAINT_MS)
}

function paint(v: ThemeId) {
  document.documentElement.dataset.theme =
    v === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : '') : v
}

export function applyTheme(v: ThemeId) {
  withColorFade(() => paint(v))
  writePref(KEY, v || 'dark')
}

export function initTheme() {
  paint(storedTheme())
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (storedTheme() === 'auto') withColorFade(() => paint('auto'))
  })
  // The disk copy can be a start ahead of web storage when the last session quit
  // through the tray, so repaint once it lands.
  void hydratePrefs().then(() => paint(storedTheme()))
}
