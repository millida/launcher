import { create } from 'zustand'
import type { CrashInfo } from '../ipc/events'
import { playSound } from '../lib/sound'

interface State {
  info: CrashInfo | null
  show: (info: CrashInfo) => void
  close: () => void
}

export const useCrash = create<State>((set) => ({
  info: null,
  show: (info) => {
    playSound('crash')
    set({ info })
  },
  close: () => set({ info: null }),
}))
