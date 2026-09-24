import { hydratePrefs, readPref, writePref } from './prefs'

/// Размер интерфейса — атрибут `data-density` на <html>, правила в 07-density.css.

const DENSITY_KEY = 'm-density'

export type Density = '' | 'compact' | 'roomy'
export type DensityPref = Density | 'auto'

export const DENSITIES: { id: DensityPref; label: string }[] = [
  { id: 'auto', label: 'Авто' },
  { id: 'compact', label: 'Плотно' },
  { id: '', label: 'Обычно' },
  { id: 'roomy', label: 'Крупно' },
]

/// Kept in step with the second tier of 09-wide.css: past this the column is
/// capped, and the freed room is what the roomy scale needs to look right.
const ROOMY_QUERY = '(min-width: 2000px)'

const wideQuery = (): MediaQueryList | null =>
  typeof matchMedia === 'function' ? matchMedia(ROOMY_QUERY) : null

/// An empty string is a choice ('Обычно') and a missing key is not, so the
/// default only reaches installs that never opened the density control.
// Выбор размера убран из настроек (правка владельца 23.09.2026: «как по
// базе будет, так и будет») — всегда авто, сохранённый выбор не читаем.
export function storedDensity(): DensityPref {
  void readPref
  void DENSITY_KEY
  return 'auto'
}

export function resolveDensity(v: DensityPref): Density {
  if (v !== 'auto') return v
  return wideQuery()?.matches ? 'roomy' : ''
}

function writeDensityAttr(v: Density) {
  const root = document.documentElement
  if (v) root.dataset.density = v
  else delete root.dataset.density
}

export function applyDensity(v: DensityPref) {
  writeDensityAttr(resolveDensity(v))
  writePref(DENSITY_KEY, v)
}

let autoDensityWatched = false

/// Resizing the window, moving it to another monitor or leaving fullscreen all
/// change which side of the breakpoint the launcher is on, and the attribute
/// has to follow — it is written once at boot and would otherwise stay stale.
function watchAutoDensity() {
  if (autoDensityWatched) return
  const mq = wideQuery()
  if (!mq) return
  autoDensityWatched = true
  mq.addEventListener('change', () => {
    if (storedDensity() === 'auto') writeDensityAttr(resolveDensity('auto'))
  })
}

/// Web storage can start empty while the durable copy on disk still holds the
/// choice, so the attribute is written again once that copy has landed.
export async function initDensity(): Promise<void> {
  writeDensityAttr(resolveDensity(storedDensity()))
  watchAutoDensity()
  await hydratePrefs()
  writeDensityAttr(resolveDensity(storedDensity()))
}
