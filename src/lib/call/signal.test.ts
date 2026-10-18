import { expect, mock, test } from 'bun:test'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

interface Pending {
  path: string
  resolve: (value: unknown) => void
}

let live = false
let requests: Pending[] = []
const dataHandlers = new Set<(data: unknown) => void>()
const liveHandlers = new Set<(live: boolean) => void>()
const catchUpHandlers = new Set<() => void>()

mock.module('../api', () => ({
  hasMillidaAccount: () => true,
  api: (path: string) =>
    new Promise((resolve) => {
      requests.push({ path, resolve })
    }),
}))

mock.module('../realtime', () => ({
  isRealtimeLive: () => live,
  onRealtimeData: (_topic: string, h: (data: unknown) => void) => {
    dataHandlers.add(h)
    return () => void dataHandlers.delete(h)
  },
  onRealtimeLiveChange: (h: (live: boolean) => void) => {
    liveHandlers.add(h)
    return () => void liveHandlers.delete(h)
  },
  onRealtimeCatchUp: (h: () => void) => {
    catchUpHandlers.add(h)
    return () => void catchUpHandlers.delete(h)
  },
}))

const { startSignalPump } = await import('./signal')

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const answer = async (i: number) => {
  requests[i]?.resolve({ cursor: 0, events: [] })
  await flush()
}

const setLive = async (next: boolean) => {
  live = next
  liveHandlers.forEach((h) => h(next))
  await flush()
}

const reconnect = async (recovered: boolean) => {
  await setLive(true)
  if (!recovered) catchUpHandlers.forEach((h) => h())
  await flush()
}

type Step = () => Promise<void>

// Input -> verdict: socket state x event -> mailbox requests. With the socket up the
// mailbox is fetched only to catch up a reconnect the server could not replay; with the
// socket down the long poll must come back at once, or calls stop ringing.
const cases: Array<[string, boolean, Step[], string[]]> = [
  ['socket up from the start: one catch-up, then silence', true, [], ['wait=0']],
  ['socket up, envelope pushed: applied without a request', true, [async () => dataHandlers.forEach((h) => h({ t: 'calls', e: { seq: 1, callId: 'c', from: 'u', kind: 'ring', ts: 1, data: {} } }))], ['wait=0']],
  ['socket up, unreadable calls poke: one catch-up', true, [async () => answer(0), async () => dataHandlers.forEach((h) => h({ t: 'calls' }))], ['wait=0', 'wait=0']],
  ['socket down from the start: long poll after every answer', false, [async () => answer(0), async () => answer(1)], ['long', 'long', 'long']],
  ['socket drops: the long poll resumes at once', true, [async () => answer(0), async () => setLive(false)], ['wait=0', 'long']],
  ['reconnect with recovery: no catch-up request', true, [async () => answer(0), async () => setLive(false), async () => reconnect(true), async () => answer(1)], ['wait=0', 'long']],
  ['reconnect without recovery: exactly one catch-up', true, [async () => answer(0), async () => setLive(false), async () => reconnect(false), async () => answer(1), async () => answer(2)], ['wait=0', 'long', 'wait=0']],
]

for (const [name, startLive, steps, want] of cases) {
  test(`call mailbox: ${name}`, async () => {
    live = startLive
    requests = []
    dataHandlers.clear()
    liveHandlers.clear()
    catchUpHandlers.clear()
    const pump = startSignalPump(() => {})
    await flush()
    for (const step of steps) await step()
    const kinds: string[] = requests.map((r) => (r.path.includes('wait=0') ? 'wait=0' : 'long'))
    pump.stop()
    requests.forEach((r) => r.resolve({ cursor: 0, events: [] }))
    await flush()
    expect(kinds, 'mailbox requests per socket state drifted from the realtime contract').toEqual(want)
  })
}
