import { create } from 'zustand'
import { hydratePrefs, readPref, writePref } from '../lib/prefs'
import { startTour } from './tour'

const DONE = 'm-onb-done'
const EVER = 'm-mil-ever'

export const ONBOARDING_STEPS = 4

interface OnboardingState {
  open: boolean
  step: number
  set: (patch: Partial<OnboardingState>) => void
}

export const useOnboarding = create<OnboardingState>((set) => ({
  open: false,
  step: 0,
  set: (patch) => set(patch as OnboardingState),
}))

export const millidaEver = (): boolean => readPref(EVER, '') === '1'

export function markMillidaEver() {
  if (millidaEver()) return
  writePref(EVER, '1')
}

export const onboardingDone = (): boolean => readPref(DONE, '') === '1'

/// The flag lives in the durable prefs file, which boot reads asynchronously —
/// deciding before it lands would show the wizard to someone who already ran it.
export async function maybeStartOnboarding() {
  await hydratePrefs()
  if (onboardingDone() || useOnboarding.getState().open) return
  useOnboarding.setState({ open: true, step: 0 })
}

export const onboardingNext = () =>
  useOnboarding.setState((s) => ({ step: Math.min(ONBOARDING_STEPS - 1, s.step + 1) }))

export const onboardingBack = () => useOnboarding.setState((s) => ({ step: Math.max(0, s.step - 1) }))

export function finishOnboarding(withTour: boolean) {
  writePref(DONE, '1')
  useOnboarding.setState({ open: false, step: 0 })
  if (withTour) startTour()
}
