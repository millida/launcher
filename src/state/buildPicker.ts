import { create } from 'zustand'

interface State {
  open: boolean
  kindLabel: string
  resolve: ((name: string | null) => void) | null
  show: (kindLabel: string) => Promise<string | null>
  choose: (name: string | null) => void
}

export const useBuildPicker = create<State>((set, get) => ({
  open: false,
  kindLabel: 'контент',
  resolve: null,
  show: (kindLabel) =>
    new Promise((res) => {
      const prev = get().resolve
      if (prev) prev(null)
      set({ open: true, kindLabel, resolve: res })
    }),
  choose: (name) => {
    const r = get().resolve
    set({ open: false, resolve: null })
    if (r) r(name)
  },
}))

export const pickBuild = (kindLabel: string): Promise<string | null> =>
  useBuildPicker.getState().show(kindLabel)
