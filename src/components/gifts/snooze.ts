import { create } from 'zustand'

interface SnoozeState {
  later: string[]
  snooze: (id: string) => void
}

/** Gifts put off with «Позже»: the lobby shows them as the small gift button instead of the card. */
export const useGiftSnooze = create<SnoozeState>((set) => ({
  later: [],
  snooze: (id) => set((s) => (s.later.includes(id) ? s : { later: [...s.later, id] })),
}))
