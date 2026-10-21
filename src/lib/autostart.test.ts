import { beforeEach, expect, mock, test } from 'bun:test'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage

const prefs = new Map<string, string>()
const setCalls: boolean[] = []
const questions: string[] = []
const toasts: string[] = []
let answer: 'yes' | 'no' | 'dismiss' = 'no'
let enableFails = false

mock.module('./prefs', () => ({
  readPref: (k: string, fallback: string) => (prefs.has(k) ? prefs.get(k)! : fallback),
  writePref: (k: string, v: string) => void prefs.set(k, v),
  hydratePrefs: async () => {},
}))
mock.module('../ipc/tauri', () => ({ hasTauri: () => true }))
mock.module('../ipc/commands', () => ({
  autostartState: async () => false,
  autostartSet: async (on: boolean) => {
    setCalls.push(on)
    if (enableFails) throw new Error('Access is denied. (os error 5)')
    return on
  },
}))
mock.module('../state/confirm', () => ({
  uiChoice: async (message: string) => {
    questions.push(message)
    return answer
  },
}))
mock.module('../state/ui', () => ({
  setScreen: () => {},
  showToast: (msg: string) => void toasts.push(msg),
}))

const { initAutostart } = await import('./autostart')
const { finishOnboarding, useOnboarding } = await import('../state/onboarding')
const { stopTour, useTour } = await import('../state/tour')

const tick = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  store.clear()
  prefs.clear()
  setCalls.length = 0
  questions.length = 0
  toasts.length = 0
  answer = 'no'
  enableFails = false
  useOnboarding.setState({ open: false, step: 0 })
  useTour.setState({ active: false, index: 0 })
})

const settledCases: Array<{ answer: 'yes' | 'no' | 'dismiss'; stored: string | null; enabled: boolean[]; why: string }> = [
  { answer: 'yes', stored: '1', enabled: [true], why: 'only an explicit yes may register the launcher at login' },
  { answer: 'no', stored: '0', enabled: [], why: 'a refusal is remembered and the system is never touched' },
  { answer: 'dismiss', stored: null, enabled: [], why: 'closing the window is no answer: stay off and ask next launch' },
]

for (const c of settledCases) {
  test(`answer ${c.answer} after the first run`, async () => {
    prefs.set('m-onb-done', '1')
    answer = c.answer
    await initAutostart()
    expect(questions.length, 'the question must be asked once the first run is over').toBe(1)
    expect(setCalls, c.why).toEqual(c.enabled)
    expect(store.get('m-autostart') ?? null, c.why).toBe(c.stored)
  })
}

test('nothing is enabled before the person answers', async () => {
  answer = 'yes'
  void initAutostart()
  await tick()
  expect(setCalls, 'the launcher turned autostart on silently while the wizard was still pending').toEqual([])
  expect(questions, 'the question must wait for the wizard, not cover it').toEqual([])
})

test('the question waits for the wizard and the guide that follows it', async () => {
  useOnboarding.setState({ open: true, step: 4 })
  answer = 'yes'
  const done = initAutostart()
  await tick()
  expect(questions, 'asked on top of the onboarding wizard').toEqual([])
  finishOnboarding(true)
  await tick()
  expect(questions, 'asked on top of the guide that starts when the wizard closes').toEqual([])
  stopTour()
  await done
  expect(questions.length, 'the question never came after the guide ended').toBe(1)
  expect(setCalls).toEqual([true])
})

test('an earlier answer is never asked again', async () => {
  prefs.set('m-onb-done', '1')
  for (const stored of ['0', '1']) {
    store.set('m-autostart', stored)
    await initAutostart()
  }
  expect(questions, 'people who already answered, or had it enabled by an older version, must not be asked').toEqual([])
  expect(setCalls, 'an existing choice must not be changed silently').toEqual([])
})

test('a system refusal is reported and remembered', async () => {
  prefs.set('m-onb-done', '1')
  answer = 'yes'
  enableFails = true
  await initAutostart()
  expect(toasts.length, 'the person said yes and must learn it did not work').toBe(1)
  expect(store.get('m-autostart'), 'without remembering, every start would ask and fail again').toBe('0')
})
