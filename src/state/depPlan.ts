import { create } from 'zustand'
import type { DepPlan, PlanItem } from '../ipc/commands'

/// `extras` are the optional dependencies the user ticked; hard dependencies are
/// installed by the core itself and are never part of the answer.
export interface DepDecision {
  go: boolean
  extras: PlanItem[]
}

interface State {
  open: boolean
  plan: DepPlan | null
  resolve: ((d: DepDecision) => void) | null
  show: (plan: DepPlan) => Promise<DepDecision>
  decide: (d: DepDecision) => void
}

const CANCEL: DepDecision = { go: false, extras: [] }

export const useDepPlan = create<State>((set, get) => ({
  open: false,
  plan: null,
  resolve: null,
  show: (plan) =>
    new Promise((res) => {
      // A second question replaces the first; the abandoned one must not leave
      // its caller waiting forever on a promise nobody will settle.
      const prev = get().resolve
      if (prev) prev(CANCEL)
      set({ open: true, plan, resolve: res })
    }),
  decide: (d) => {
    const r = get().resolve
    set({ open: false, plan: null, resolve: null })
    if (r) r(d)
  },
}))

export const askDepPlan = (plan: DepPlan): Promise<DepDecision> => useDepPlan.getState().show(plan)
