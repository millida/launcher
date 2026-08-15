import { create } from 'zustand'

interface ConfirmOpts {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  rememberKey?: string
  rememberLabel?: string
}

/// A dismissal is not the cancel button. Where the cancel button carries its own
/// action ("Всё равно зайти", "Играть офлайн"), closing the window by the
/// backdrop or Escape used to perform that action — the launcher did something
/// the user only walked away from. 'dismiss' says "forget the whole question".
export type ConfirmResult = 'yes' | 'no' | 'dismiss'

interface ConfirmState {
  open: boolean
  message: string
  title: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  rememberKey: string | null
  rememberLabel: string
  resolver: ((v: ConfirmResult) => void) | null
  close: (v: ConfirmResult, remember?: boolean) => void
}

const skipKey = (key: string) => 'm-skip-' + key

export const isConfirmSkipped = (key: string) => localStorage.getItem(skipKey(key)) === '1'

export function resetConfirmSkip(key: string) {
  localStorage.removeItem(skipKey(key))
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  message: '',
  title: 'Подтверждение',
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  danger: true,
  rememberKey: null,
  rememberLabel: 'Больше не спрашивать',
  resolver: null,
  close: (v, remember) => {
    const { resolver, rememberKey } = get()
    // Remembering a refusal would silently block the action forever, so only a confirm sticks.
    if (v === 'yes' && remember && rememberKey) {
      try {
        localStorage.setItem(skipKey(rememberKey), '1')
      } catch {}
    }
    set({ open: false, resolver: null, rememberKey: null })
    if (resolver) resolver(v)
  },
}))

export function uiChoice(message: string, opts: ConfirmOpts = {}): Promise<ConfirmResult> {
  if (opts.rememberKey && isConfirmSkipped(opts.rememberKey)) return Promise.resolve<ConfirmResult>('yes')
  const prev = useConfirm.getState().resolver
  if (prev) prev('dismiss')
  return new Promise((resolve) => {
    useConfirm.setState({
      open: true,
      message,
      title: opts.title || 'Подтверждение',
      confirmLabel: opts.confirmLabel || 'Подтвердить',
      cancelLabel: opts.cancelLabel || 'Отмена',
      danger: opts.danger ?? true,
      rememberKey: opts.rememberKey || null,
      rememberLabel: opts.rememberLabel || 'Больше не спрашивать',
      resolver: resolve,
    })
  })
}

/// For questions whose cancel button means "do nothing": a dismissal is the same
/// answer. Anything else must ask through uiChoice and handle 'dismiss' itself.
export function uiConfirm(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return uiChoice(message, opts).then((v) => v === 'yes')
}
