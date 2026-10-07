import { create } from 'zustand'
import { loadPlus } from '../lib/gameProfile'
import { hasMillidaAccount } from '../lib/api'
import type { ShopTier } from '../lib/rubies'

interface PlusState {
  /** Уровень подписки: гардероб и магазин пишут цены «С PLUS» и скидку по нему. */
  tier: ShopTier
  setTier: (tier: ShopTier) => void
  active: boolean
  diamond: boolean
  setActive: (active: boolean) => void
  load: () => Promise<void>
}

let seq = 0

export const usePlus = create<PlusState>((set) => ({
  tier: null,
  setTier: (tier) => set({ tier, active: tier !== null, diamond: tier === 'DIAMOND' }),
  active: false,
  diamond: false,
  setActive: (active) => {
    seq++
    set((s) => ({ active, tier: active ? s.tier ?? 'PLUS' : null, diamond: active ? s.diamond : false }))
  },
  load: async () => {
    const mine = ++seq
    if (!hasMillidaAccount()) {
      set({ active: false, tier: null, diamond: false })
      return
    }
    const status = await loadPlus().catch(() => null)
    if (mine !== seq || !status) return
    set({
      active: status.active,
      tier: status.active ? status.tier ?? 'PLUS' : null,
      diamond: status.active && status.tier === 'DIAMOND',
    })
  },
}))
