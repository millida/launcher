import { create } from 'zustand'

/** Метка, по которой сужена сетка скинов (клик по «#аниме» на странице скина или в ряду меток). */
export interface SkinTagPick {
  slug: string
  label: string
}

export const useSkinTag = create<{ tag: SkinTagPick | null; set: (t: SkinTagPick | null) => void }>((set) => ({
  tag: null,
  set: (tag) => set({ tag }),
}))
