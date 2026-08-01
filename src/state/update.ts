import { create } from 'zustand'

export type BootPhase = 'idle' | 'checking' | 'downloading' | 'installing'

interface UpdateState {
  version: string | null
  staged: boolean
  busy: boolean
  manual: boolean
  failed: boolean
  bootPhase: BootPhase
  bootPct: number
  set: (p: Partial<UpdateState>) => void
}

export const useUpdate = create<UpdateState>((set) => ({
  version: null,
  staged: false,
  busy: false,
  manual: false,
  failed: false,
  bootPhase: 'idle',
  bootPct: 0,
  set: (p) => set(p),
}))
