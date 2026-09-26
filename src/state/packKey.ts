import { create } from 'zustand'

interface State {
  slug: string | null
  title: string
  reason: string
  retry: (() => void) | null
  show: (slug: string, title: string, reason: string, retry: () => void) => void
  close: () => void
}

/// A paid catalog pack started outside a pack page (a millida://modpack link) still has to ask for its key.
export const usePackKey = create<State>((set) => ({
  slug: null,
  title: '',
  reason: '',
  retry: null,
  show: (slug, title, reason, retry) => set({ slug, title, reason, retry }),
  close: () => set({ slug: null, title: '', reason: '', retry: null }),
}))
