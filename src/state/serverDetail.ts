import { create } from 'zustand'
import type { SnapshotServer } from '../lib/snapshot'

interface State {
  sv: SnapshotServer | null
  open: (sv: SnapshotServer) => void
  close: () => void
}

export const useServerDetail = create<State>((set) => ({
  sv: null,
  open: (sv) => set({ sv }),
  close: () => set({ sv: null }),
}))

export const openServerDetail = (sv: SnapshotServer) => useServerDetail.getState().open(sv)
