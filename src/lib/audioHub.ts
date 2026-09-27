export interface HubContext {
  readonly state: AudioContextState
  resume(): Promise<void>
  suspend(): Promise<void>
}

export interface HubClock {
  now(): number
  set(fn: () => void, ms: number): unknown
  clear(id: unknown): void
}

export interface AudioHub<C extends HubContext> {
  context(): C | null
  hold(ms: number): void
  lease(): () => void
}

export const IDLE_SUSPEND_MS = 4000

const browserClock: HubClock = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}

/**
 * A running context keeps the output device open for the whole process, and on
 * macOS WebKit also pins the device to its small render buffer, which leaves
 * every other app's sound choppy. The context therefore runs only while
 * something is audible or explicitly leased, and is suspended once idle.
 */
export function createAudioHub<C extends HubContext>(
  make: () => C | null,
  clock: HubClock = browserClock,
  idleMs = IDLE_SUSPEND_MS,
): AudioHub<C> {
  let ctx: C | null = null
  let leases = 0
  let busyUntil = 0
  let timer: unknown = null

  const disarm = () => {
    if (timer !== null) clock.clear(timer)
    timer = null
  }

  const arm = () => {
    disarm()
    if (!ctx || leases > 0) return
    const wait = Math.max(0, busyUntil - clock.now()) + idleMs
    timer = clock.set(() => {
      timer = null
      if (!ctx || leases > 0) return
      if (clock.now() < busyUntil) {
        arm()
        return
      }
      if (ctx.state === 'running') void ctx.suspend().catch(() => {})
    }, wait)
  }

  return {
    context() {
      if (!ctx || ctx.state === 'closed') {
        try {
          ctx = make()
        } catch {
          ctx = null
        }
      }
      if (timer === null) arm()
      return ctx
    },
    hold(ms) {
      busyUntil = Math.max(busyUntil, clock.now() + Math.max(0, ms))
      arm()
    },
    lease() {
      leases++
      disarm()
      let done = false
      return () => {
        if (done) return
        done = true
        leases--
        arm()
      }
    },
  }
}

const browserContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Ctor ? new Ctor() : null
}

export const sharedAudio: AudioHub<AudioContext> = createAudioHub(browserContext)
