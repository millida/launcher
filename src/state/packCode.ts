import { create } from 'zustand'

interface State {
  open: boolean
  code: string
  show: (code?: string) => void
  close: () => void
}

/// Установка сборки по коду. Код приходит либо из поля ввода, либо из ссылки
/// millida://pack/<код> — тогда окно открывается уже с ним.
export const usePackCode = create<State>((set) => ({
  open: false,
  code: '',
  show: (code = '') => set({ open: true, code }),
  close: () => set({ open: false, code: '' }),
}))
