import { create } from 'zustand'

export interface GiftTarget {
  userId: string
  nickname: string
}

interface PickerState {
  ask: { name: string; onPick: (friend: GiftTarget) => void } | null
  open: (name: string, onPick: (friend: GiftTarget) => void) => void
  close: () => void
}

export const useGiftPick = create<PickerState>((set) => ({
  ask: null,
  open: (name, onPick) => set({ ask: { name, onPick } }),
  close: () => set({ ask: null }),
}))

export const openGiftPicker = (name: string, onPick: (friend: GiftTarget) => void) => useGiftPick.getState().open(name, onPick)
