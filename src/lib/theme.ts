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
  // A transition only starts when the declaration that carries it was already in
  // effect on the previous computed style. Adding the class and moving the
  // palette in one go gave the engine a single recalculation, so the colours sat
  // on the old values for the whole fade and only crawled over once the class
  // came back off — a theme looked like it had not applied at all. The flush
  // gives the transition a "before" to start from.
  void root.offsetWidth
  change()
  clearTimeout(paintTimer)
  paintTimer = setTimeout(() => root.classList.remove('color-fade'), PAINT_MS)
}

/// A theme pack drawn against one palette pins it: the kit still carries
/// light-only rules, and letting the dark/light switch fight the pack would
/// leave half the screen in the wrong set of colours.
let pinnedBase: '' | 'light' | 'dark' = ''

export function pinThemeBase(v: '' | 'light' | 'dark') {
  pinnedBase = v
  paint(storedTheme())
}

export function themeBasePinned(): '' | 'light' | 'dark' {
  return pinnedBase
}

function paint(v: ThemeId) {
  if (pinnedBase) {
    document.documentElement.dataset.theme = pinnedBase === 'light' ? 'light' : ''
    return
  }
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
