import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'

/**
 * Раскладка окна (07.10.2026): «Лобби» — нынешняя, с персонажем и верхней
 * полосой; «Классика» — старая, с боковой панелью разделов и главной с героем
 * последней сборки. Новые разделы (магазин, топ, PLUS) живут в обеих.
 */
export type Layout = 'lobby' | 'classic'

const fromUrl = (): Layout | null => {
  if (!import.meta.env.DEV) return null
  const v = new URLSearchParams(location.search).get('layout')
  return v === 'classic' || v === 'lobby' ? v : null
}

const initial = (): Layout => fromUrl() ?? (readPref('m-layout', 'lobby') === 'classic' ? 'classic' : 'lobby')

const apply = (l: Layout) => document.documentElement.classList.toggle('lay-classic', l === 'classic')

export const useLayout = create<{ layout: Layout; set: (l: Layout) => void }>((set) => ({
  layout: initial(),
  set: (layout) => {
    writePref('m-layout', layout)
    apply(layout)
    set({ layout })
  },
}))

apply(useLayout.getState().layout)

