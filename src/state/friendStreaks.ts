import { create } from 'zustand'
import { api, hasMillidaAccount } from '../lib/api'

/** Служба кэширует ответ 2 минуты — чаще спрашивать незачем. */
const FRESH_MS = 2 * 60_000

interface State {
  /** userId друга → его серия дней (только у кого она есть и кто не скрыл активность). */
  byId: Record<string, number>
  at: number
  load: () => Promise<void>
}

/** Огоньки друзей (GET /friends/streaks, 06.10.2026): одно число на друга. */
export const useFriendStreaks = create<State>((set, get) => ({
  byId: {},
  at: 0,
  load: async () => {
    if (!hasMillidaAccount() || Date.now() - get().at < FRESH_MS) return
    set({ at: Date.now() })
    try {
      const r = await api<{ streaks?: Record<string, number> }>('/friends/streaks')
      set({ byId: r && r.streaks && typeof r.streaks === 'object' ? r.streaks : {} })
    } catch {
      /* старая служба ручки не знает — огоньков просто нет */
    }
  },
}))
