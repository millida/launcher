import { create } from 'zustand'
import '../styles/pixel/contrast.css'

export const TEXT_SCALES = [100, 115, 130, 150] as const
export type TextScale = (typeof TEXT_SCALES)[number]

const SCALE_KEY = 'm-text-scale'
const CONTRAST_KEY = 'm-contrast'

export function parseScale(raw: string | null): TextScale {
  const n = Number(raw)
  return (TEXT_SCALES as readonly number[]).includes(n) ? (n as TextScale) : 100
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

let zoomLoaded = false

function applyScale(scale: TextScale) {
  if (scale === 100 && !zoomLoaded) return
  zoomLoaded = true
  void import('./uiZoom')
    .then((m) => m.applyUiZoom(scale, () => useA11y.getState().scale))
    .catch((e) => console.warn('[a11y] interface size', e))
}

function apply(scale: TextScale, contrast: boolean) {
  if (typeof document === 'undefined') return
  applyScale(scale)
  const root = document.documentElement
  if (contrast) root.setAttribute('data-contrast', 'high')
  else root.removeAttribute('data-contrast')
}

interface A11yState {
  scale: TextScale
  contrast: boolean
  setScale: (s: TextScale) => void
  setContrast: (on: boolean) => void
}

export const useA11y = create<A11yState>((set, get) => ({
  scale: parseScale(read(SCALE_KEY)),
  contrast: read(CONTRAST_KEY) === '1',
  setScale: (scale) => {
    write(SCALE_KEY, String(scale))
    apply(scale, get().contrast)
    set({ scale })
  },
  setContrast: (contrast) => {
    write(CONTRAST_KEY, contrast ? '1' : '0')
    apply(get().scale, contrast)
    set({ contrast })
  },
}))

export function initA11y() {
  const { scale, contrast } = useA11y.getState()
  apply(scale, contrast)
}

// Applied at import, before the first paint: contrast is set at once, a bigger size as soon as its chunk loads.
initA11y()
