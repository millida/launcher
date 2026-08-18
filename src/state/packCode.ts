import { create } from 'zustand'

interface State {
  open: boolean
  code: string
  show: (code?: string) => void
  close: () => void
}

/// Installing a build by code. The code comes either from the input or from a
/// millida://pack/<code> link, in which case the window opens with it filled in.
export const usePackCode = create<State>((set) => ({
  open: false,
  code: '',
  show: (code = '') => set({ open: true, code }),
  close: () => set({ open: false, code: '' }),
}))
