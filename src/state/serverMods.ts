import { create } from 'zustand'
import type { ModsPlan } from '../lib/serverModsPlan'
import { closeModal, openModal } from './ui'

/// `optional` and `custom` hold the sha512 of what the player kept ticked.
/// `without` joins with the build as it is; `cancel` stays in the launcher.
export interface ModsDecision {
  action: 'install' | 'without' | 'cancel'
  optional: string[]
  custom: string[]
}

export interface ModsProgress {
  done: number
  total: number
  current: string
}

type Phase = 'ask' | 'install' | 'failed'

interface State {
  open: boolean
  phase: Phase
  plan: ModsPlan | null
  progress: ModsProgress | null
  failed: string[]
  resolve: ((d: ModsDecision) => void) | null
  retry: ((joinAnyway: boolean) => void) | null
  ask: (plan: ModsPlan) => Promise<ModsDecision>
  decide: (d: ModsDecision) => void
  installing: (plan: ModsPlan, progress: ModsProgress) => void
  failures: (failed: string[]) => Promise<boolean>
  settle: (joinAnyway: boolean) => void
  close: () => void
}

const CANCEL: ModsDecision = { action: 'cancel', optional: [], custom: [] }

/// The store lives in the lazy chunk; the startup bundle only knows the modal id that mounts the window.
const mount = (open: boolean) => (open ? openModal('smModal') : closeModal('smModal'))

export const useServerMods = create<State>((set, get) => ({
  open: false,
  phase: 'ask',
  plan: null,
  progress: null,
  failed: [],
  resolve: null,
  retry: null,
  ask: (plan) =>
    new Promise((res) => {
      // A second join replaces the first question; the abandoned caller must not wait forever.
      get().resolve?.(CANCEL)
      get().retry?.(false)
      set({ open: true, phase: 'ask', plan, progress: null, failed: [], resolve: res, retry: null })
      mount(true)
    }),
  decide: (d) => {
    const r = get().resolve
    set(d.action === 'install' ? { resolve: null } : { open: false, plan: null, resolve: null })
    if (d.action !== 'install') mount(false)
    r?.(d)
  },
  installing: (plan, progress) => {
    set({ open: true, phase: 'install', plan, progress })
    mount(true)
  },
  failures: (failed) =>
    new Promise((res) => {
      get().retry?.(false)
      set({ open: true, phase: 'failed', failed, retry: res })
      mount(true)
    }),
  settle: (joinAnyway) => {
    const r = get().retry
    set({ open: false, plan: null, progress: null, failed: [], retry: null })
    mount(false)
    r?.(joinAnyway)
  },
  close: () => {
    set({ open: false, plan: null, progress: null, failed: [], resolve: null, retry: null })
    mount(false)
  },
}))
