import { beforeEach, expect, mock, test } from 'bun:test'

// One file covers both stores: mock.module registrations are global to the test
// run, so splitting them would leave two suites fighting over the same paths.
const prefs = new Map<string, string>()
const screens: string[] = []
let hydrated = 0
let diskDone = ''

mock.module('../lib/prefs', () => ({
  readPref: (k: string, fallback: string) => (prefs.has(k) ? prefs.get(k)! : fallback),
  writePref: (k: string, v: string) => void prefs.set(k, v),
  hydratePrefs: async () => {
    hydrated += 1
    // The disk copy wins on boot: a wiped web storage must not re-run the wizard.
    if (diskDone) prefs.set('m-onb-done', diskDone)
  },
}))
mock.module('./ui', () => ({ setScreen: (s: string) => void screens.push(s) }))

const { finishOnboarding, markMillidaEver, maybeStartOnboarding, millidaEver, useOnboarding } = await import(
  './onboarding'
)
const { TOUR_STEPS, startTour, stopTour, tourDone, tourNext, tourPrev, useTour } = await import('./tour')

beforeEach(() => {
  prefs.clear()
  screens.length = 0
  diskDone = ''
  hydrated = 0
  useOnboarding.setState({ open: false, step: 0 })
  useTour.setState({ active: false, index: 0 })
})

test('first run opens the wizard, a finished one never does again', async () => {
  await maybeStartOnboarding()
  expect(useOnboarding.getState().open).toBe(true)
  finishOnboarding(false)
  expect(useOnboarding.getState().open).toBe(false)
  diskDone = '1'
  await maybeStartOnboarding()
  expect(useOnboarding.getState().open).toBe(false)
})

/// Web storage is cleared by every "reset the launcher" advice on the internet;
/// the durable file is what the decision must be based on.
test('the wizard decision waits for the durable prefs file', async () => {
  diskDone = '1'
  await maybeStartOnboarding()
  expect(hydrated).toBe(1)
  expect(useOnboarding.getState().open).toBe(false)
})

test('finishing with the guide starts the tour, without it does not', () => {
  finishOnboarding(true)
  expect(useTour.getState().active).toBe(true)
  useTour.setState({ active: false, index: 0 })
  finishOnboarding(false)
  expect(useTour.getState().active).toBe(false)
})

test('the Millida-login flag is off until a login marks it, and then it sticks', () => {
  expect(millidaEver()).toBe(false)
  markMillidaEver()
  expect(millidaEver()).toBe(true)
  expect(prefs.get('m-mil-ever')).toBe('1')
})

test('a step that names a screen navigates to it, a step without one leaves the screen alone', () => {
  startTour()
  expect(screens).toEqual(['play'])
  tourNext()
  expect(screens).toEqual(['play', 'play'])
  tourNext()
  expect(screens.length).toBe(2)
})

/// The last "Далее" is the only way most users end the tour, so it must also
/// record completion — otherwise the guide reopens on the next launch.
test('walking to the end closes the tour and marks it done', () => {
  startTour()
  for (let i = 0; i < TOUR_STEPS.length; i++) tourNext()
  expect(useTour.getState().active).toBe(false)
  expect(tourDone()).toBe(true)
})

test('skipping marks the tour done', () => {
  startTour()
  stopTour()
  expect(useTour.getState().active).toBe(false)
  expect(tourDone()).toBe(true)
})

test('back stops at the first step instead of falling off the list', () => {
  startTour()
  tourPrev()
  tourPrev()
  expect(useTour.getState().index).toBe(0)
  expect(useTour.getState().active).toBe(true)
})

test('every step points at a selector and carries text', () => {
  TOUR_STEPS.forEach((s, i) => {
    expect(
      s.sel.length,
      'step ' + i + ' has no target selector: an empty one dims the screen with no highlight',
    ).toBeGreaterThan(0)
    expect(s.title.length && s.text.length, 'step ' + i + ' is missing title or text').toBeTruthy()
  })
})
