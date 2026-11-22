import { create } from 'zustand'
import { hasMillidaAccount } from '../lib/api'
import { loadGiftHistory, type GiftHistory, type ReceivedGift } from '../lib/gifts'

interface GiftsState {
  history: GiftHistory | null
  failed: boolean
  opening: string | null
  load: () => Promise<void>
  markOpened: (gift: ReceivedGift) => void
  showGift: (id: string) => void
  hideGift: () => void
}

let seq = 0

export const useGifts = create<GiftsState>((set, get) => ({
  history: null,
  failed: false,
  opening: null,
  load: async () => {
    if (!hasMillidaAccount()) {
      seq += 1
      set({ history: null, failed: false })
      return
    }
    const mine = ++seq
    try {
      const history = await loadGiftHistory()
      if (mine !== seq) return
      set({ history, failed: false })
    } catch (err) {
      if (mine !== seq) return
      console.warn('[gifts] history', err)
      set({ failed: true })
    }
  },
  markOpened: (gift) => {
    const history = get().history
    if (!history) return
    const received = history.received.map((g) => (g.id === gift.id ? { ...gift, opened: true } : g))
    set({ history: { ...history, received, unopened: received.filter((g) => !g.opened).length } })
  },
  showGift: (id) => set({ opening: id }),
  hideGift: () => set({ opening: null }),
}))

export const showGift = (id: string) => useGifts.getState().showGift(id)
