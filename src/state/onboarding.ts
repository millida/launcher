import { create } from 'zustand'
import { hydratePrefs, readPref, writePref } from '../lib/prefs'
import { startTour } from './tour'

const DONE = 'm-onb-done'
const EVER = 'm-mil-ever'

export const ONBOARDING_STEPS = 5
/** Шаг «Кто тебя позвал?» — без аккаунта Millida спрашивать некого. */
export const INVITER_STEP = 1

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

export const onboardingNext = (skipInviter = false) =>
  useOnboarding.setState((s) => {
    let next = s.step + 1
    if (skipInviter && next === INVITER_STEP) next += 1
    return { step: Math.min(ONBOARDING_STEPS - 1, next) }
  })

export const onboardingBack = (skipInviter = false) =>
  useOnboarding.setState((s) => {
    let prev = s.step - 1
    if (skipInviter && prev === INVITER_STEP) prev -= 1
    return { step: Math.max(0, prev) }
  })

export function finishOnboarding(withTour: boolean) {
  writePref(DONE, '1')
  useOnboarding.setState({ open: false, step: 0 })
  if (withTour) startTour()
}
