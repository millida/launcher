import { create } from 'zustand'
import { loadPlus } from '../lib/gameProfile'
import { hasMillidaAccount } from '../lib/api'

interface PlusState {
  active: boolean
  setActive: (active: boolean) => void
  load: () => Promise<void>
}

let seq = 0

export const usePlus = create<PlusState>((set) => ({
  active: false,
  setActive: (active) => {
    seq++
    set({ active })
  },
  load: async () => {
    const mine = ++seq
    if (!hasMillidaAccount()) {
      set({ active: false })
      return
    }
    const status = await loadPlus().catch(() => null)
    if (mine !== seq || !status) return
    set({ active: status.active })
  },
}))
