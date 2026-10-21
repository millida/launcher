import { create } from 'zustand'
import { t } from '../../i18n'

/** Метка, по которой сужена сетка скинов (клик по «#аниме» на странице скина или в ряду меток). */
export interface SkinTagPick {
  slug: string
  label: string
}

/// Skin tags come from the API in Russian; the set is closed, so the label is translated here.
export const skinTagLabel = (label: string): string => t(label)

export const useSkinTag = create<{ tag: SkinTagPick | null; set: (t: SkinTagPick | null) => void }>((set) => ({
  tag: null,
  set: (tag) => set({ tag }),
}))
