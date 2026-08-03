import { hydratePrefs, readPref, writePref } from './prefs'

export type ThemeId = '' | 'light' | 'auto'

const KEY = 'm-theme'

export function storedTheme(): ThemeId {
  const v = readPref(KEY, 'dark')
  return v === 'light' || v === 'auto' ? v : ''
}

function paint(v: ThemeId) {
  document.documentElement.dataset.theme =
    v === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : '') : v
}

export function applyTheme(v: ThemeId) {
  paint(v)
  writePref(KEY, v || 'dark')
}

export function initTheme() {
  paint(storedTheme())
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (storedTheme() === 'auto') paint('auto')
  })
  // The disk copy can be a start ahead of web storage when the last session quit
  // through the tray, so repaint once it lands.
  void hydratePrefs().then(() => paint(storedTheme()))
}
