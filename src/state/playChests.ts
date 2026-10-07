import { create } from 'zustand'
import { claimPlayChest, loadPlayChests, type PlayChests } from '../lib/rubies'
import { hasMillidaAccount } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { showToast } from './ui'
import { openChestFlow } from '../components/daily/ChestOpen'

/**
 * Сундуки за игру (06.10.2026, служба 47ea1c7d8): час игры за сутки — обычный
 * сундук, до трёх в сутки. Одно состояние на строку под «Играть» и блок
 * «Бонусы» в магазине; забранный сундук открывается обычным путём сундуков.
 */
interface PlayChestsState {
  view: PlayChests | null
  /** Когда пришёл ответ: «через N мин» считается от него. */
  at: number
  busy: boolean
  load: () => Promise<void>
  claim: () => Promise<void>
}

export const usePlayChests = create<PlayChestsState>((set, get) => ({
  view: null,
  at: 0,
  busy: false,
  load: async () => {
    if (!hasMillidaAccount()) return
    try {
      set({ view: await loadPlayChests(), at: Date.now() })
    } catch {
      /* старая служба без ручки — строки и слотов просто нет */
    }
  },
  claim: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      const res = await claimPlayChest()
      set({ view: res, at: Date.now() })
      openChestFlow([{ id: res.chestId, tier: 'COMMON', source: 'play', title: res.chest, createdAt: new Date().toISOString() }])
    } catch (e) {
      showToast(apiErrorText(e, 'Сундук не забрался, попробуй позже'), 'error')
      void get().load()
    } finally {
      set({ busy: false })
    }
  },
}))

/** «34 мин» / «1 ч 05 мин» до следующего сундука. */
export function playLeftText(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60))
  if (m < 60) return m + ' мин'
  return Math.floor(m / 60) + ' ч ' + String(m % 60).padStart(2, '0') + ' мин'
}
