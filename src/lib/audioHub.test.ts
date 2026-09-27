import { describe, expect, it } from 'bun:test'
import { createAudioHub, type HubClock, type HubContext } from './audioHub'

class FakeContext implements HubContext {
  state: AudioContextState = 'running'
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }
}

class FakeClock implements HubClock {
  t = 0
  private jobs = new Map<number, { at: number; fn: () => void }>()
  private seq = 0
  now = () => this.t
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq
    this.jobs.set(id, { at: this.t + ms, fn })
    return id
  }
  clear = (id: unknown) => {
    this.jobs.delete(id as number)
  }
  advance(ms: number) {
    const end = this.t + ms
    for (;;) {
      const due = [...this.jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.jobs.delete(due[0])
      this.t = due[1].at
      due[1].fn()
    }
    this.t = end
  }
}

const IDLE = 1000

type Step = { hold?: number; lease?: true; release?: true; wait: number }

const run = (steps: Step[]) => {
  const clock = new FakeClock()
  const made: FakeContext[] = []
  const hub = createAudioHub(
    () => {
      const c = new FakeContext()
      made.push(c)
      return c
    },
    clock,
    IDLE,
  )
  hub.context()
  const releases: (() => void)[] = []
  for (const s of steps) {
    if (s.hold !== undefined) hub.hold(s.hold)
    if (s.lease) releases.push(hub.lease())
    if (s.release) releases.shift()?.()
    clock.advance(s.wait)
  }
  return { state: made[0]!.state, contexts: made.length }
}

// Input -> verdict. A context left running holds the output device for the
// whole session: on macOS that is what turned every other app's sound robotic.
const CASES: { why: string; steps: Step[]; state: AudioContextState }[] = [
  {
    why: 'a context created at startup for decoding must not keep the device open',
    steps: [{ wait: IDLE + 1 }],
    state: 'suspended',
  },
  {
    why: 'a sound still playing must not be cut off by the idle timer',
    steps: [{ hold: 3000, wait: 3000 + IDLE - 1 }],
    state: 'running',
  },
  {
    why: 'once the last sound has faded the device is released',
    steps: [{ hold: 3000, wait: 3000 + IDLE + 1 }],
    state: 'suspended',
  },
  {
    why: 'a live meter in a call holds the context however long the call lasts',
    steps: [{ lease: true, wait: 60 * 60 * 1000 }],
    state: 'running',
  },
  {
    why: 'the meter released at hang-up must not leave the device open for good',
    steps: [{ lease: true, wait: 5000 }, { release: true, wait: IDLE + 1 }],
    state: 'suspended',
  },
  {
    why: 'a later sound restarts the idle countdown instead of being cut by an older one',
    steps: [{ hold: 0, wait: IDLE - 10 }, { hold: 500, wait: 100 }],
    state: 'running',
  },
]

describe('shared audio context releases the device when idle', () => {
  for (const c of CASES) {
    it(c.why, () => {
      const got = run(c.steps)
      expect(got.state, c.why).toBe(c.state)
      expect(got.contexts, 'one context per page: every extra one keeps its own device stream').toBe(1)
    })
  }

  it('the same context is handed out on every call', () => {
    const hub = createAudioHub(() => new FakeContext(), new FakeClock(), IDLE)
    expect(hub.context(), 'a fresh context per sound would open the device again each time').toBe(hub.context())
  })
})
