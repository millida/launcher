import { create } from 'zustand'

interface ConfirmOpts {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState {
  open: boolean
  message: string
  title: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  resolver: ((v: boolean) => void) | null
  close: (v: boolean) => void
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  message: '',
  title: 'Подтверждение',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  danger: true,
  resolver: null,
  close: (v) => {
    const r = get().resolver
    set({ open: false, resolver: null })
    if (r) r(v)
  },
}))

export function uiConfirm(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  const prev = useConfirm.getState().resolver
  if (prev) prev(false)
  return new Promise((resolve) => {
    useConfirm.setState({
      open: true,
      message,
      title: opts.title || 'Подтверждение',
      confirmLabel: opts.confirmLabel || 'Подтвердить',
      cancelLabel: opts.cancelLabel || 'Отмена',
      danger: opts.danger ?? true,
      resolver: resolve,
    })
  })
}
