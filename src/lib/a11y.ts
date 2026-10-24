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

/// The whole interface scales, not only the text: most sizes in the launcher are in px,
/// so a bigger font alone would overflow every button.
function apply(scale: TextScale, contrast: boolean) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('zoom', scale === 100 ? '' : String(scale / 100))
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

// Applied at import, before the first paint, so a scaled interface never flashes at 100%.
initA11y()
