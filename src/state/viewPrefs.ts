import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'

export const VIEW_PREFS_EVENT = 'm-view-prefs'

export const TAB_MS_DEFAULT = 380
export const TAB_MS_MIN = 0
export const TAB_MS_MAX = 900

const readBool = (v: string) => v !== '0'

export function charAnimOn(): boolean {
  return readBool(readPref('m-anim-char', '1'))
}

export function bgAnimOn(): boolean {
  return readBool(readPref('m-anim-bg', '1'))
}

export function tabTransitionMs(): number {
  const n = Number(readPref('m-tab-ms', String(TAB_MS_DEFAULT)))
  if (!Number.isFinite(n)) return TAB_MS_DEFAULT
  return Math.max(TAB_MS_MIN, Math.min(TAB_MS_MAX, Math.round(n)))
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
    set({ tabMs: ms })
    notify()
  },
  setPerf: (v) => {
    writePref('m-perf-mode', v)
    set({ perf: v })
    notify()
  },
}))
