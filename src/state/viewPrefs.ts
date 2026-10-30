import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'
import { liteOn, onLiteChange } from '../lib/liteMode'

export const VIEW_PREFS_EVENT = 'm-view-prefs'

/// Весь переход между вкладками — не дольше 100 мс (приказ владельца 27.10.2026; было 118 мс въезда и ещё 340 мс
/// пиксельной волны поверх него). Экран въезжает за 0,42 от этого числа (applyTabMs), волна идёт все эти миллисекунды:
/// фронт (TAB_WAVE_FLASH_MS меньше) и вспышка за ним. На слабом ПК перехода нет вовсе.
export const TAB_MS_DEFAULT = 100
/// Вспышка за фронтом пиксельной волны (ScreenWave), мс.
export const TAB_WAVE_FLASH_MS = 60
/// Значения, которые лаунчер сам записывал или предлагал как «Обычно»/«Быстро» раньше: это след прежнего умолчания,
/// а не выбор игрока, и они идут за новым.
const TAB_MS_LEGACY_DEFAULTS = ['380', '280', '190']
export const TAB_MS_MIN = 0
export const TAB_MS_MAX = 900

const readBool = (v: string) => v !== '0'

export function charAnimOn(): boolean {
  return readBool(readPref('m-anim-char', '1'))
}

export function bgAnimOn(): boolean {
  return readBool(readPref('m-anim-bg', '1'))
}

/// Выбор игрока главнее; без выбора — быстрый переход, а на слабом ПК (лёгкий режим) — без перехода.
export function tabTransitionMs(): number {
  const stored = readPref('m-tab-ms', '')
  const fallback = liteOn() ? 0 : TAB_MS_DEFAULT
  if (stored === '' || TAB_MS_LEGACY_DEFAULTS.includes(stored)) return fallback
  const n = Number(stored)
  if (!Number.isFinite(n)) return fallback
  return Math.max(TAB_MS_MIN, Math.min(TAB_MS_MAX, Math.round(n)))
}

/// Сколько идёт фронт пиксельной волны при общей длительности перехода `ms`: вспышка за фронтом входит в неё же.
export function waveFrontMs(ms: number): number {
  return Math.max(0, ms - TAB_WAVE_FLASH_MS)
}

export type PerfMode = 'auto' | 'low' | 'high'

export function perfMode(): PerfMode {
  const v = readPref('m-perf-mode', 'auto')
  return v === 'low' || v === 'high' ? v : 'auto'
}

interface ViewPrefsState {
  charAnim: boolean
  bgAnim: boolean
  tabMs: number
  perf: PerfMode
  setCharAnim: (v: boolean) => void
  setBgAnim: (v: boolean) => void
  setTabMs: (v: number) => void
  setPerf: (v: PerfMode) => void
}

const notify = () => window.dispatchEvent(new Event(VIEW_PREFS_EVENT))

/**
 * Переход между экранами (07.10.2026): вместо пиксельного растворения — плавный
 * въезд экрана, как переключатель в чате Милли. Длительность — из настройки.
 */
function applyTabMs(ms: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--m-tab-ms', Math.round(ms * 0.42) + 'ms')
}
applyTabMs(tabTransitionMs())

export const useViewPrefs = create<ViewPrefsState>((set) => ({
  charAnim: charAnimOn(),
  bgAnim: bgAnimOn(),
  tabMs: tabTransitionMs(),
  perf: perfMode(),
  setCharAnim: (v) => {
    writePref('m-anim-char', v ? '1' : '0')
    set({ charAnim: v })
    notify()
  },
  setBgAnim: (v) => {
    writePref('m-anim-bg', v ? '1' : '0')
    set({ bgAnim: v })
    notify()
  },
  setTabMs: (v) => {
    const ms = Math.max(TAB_MS_MIN, Math.min(TAB_MS_MAX, Math.round(v)))
    writePref('m-tab-ms', String(ms))
    applyTabMs(ms)
    set({ tabMs: ms })
    notify()
  },
  setPerf: (v) => {
    writePref('m-perf-mode', v)
    set({ perf: v })
    notify()
  },
}))

// Лёгкий режим включается позже первого кадра (ядро называет железо в простое): переход без выбора игрока
// становится мгновенным, как только режим определился.
onLiteChange(() => {
  const ms = tabTransitionMs()
  applyTabMs(ms)
  useViewPrefs.setState({ tabMs: ms })
})
