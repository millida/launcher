import { pollDelayMs } from './pollPace'

export const REALTIME_TOPICS = ['friends', 'presence', 'calls', 'inbox'] as const
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number]

export const REALTIME_HOST = 'api.millida.net'
export const REALTIME_FALLBACK_MS = 60_000
export const REALTIME_STRETCHED_MS = 120_000
export const REALTIME_OFF_RETRY_MS = 600_000
export const REALTIME_ERROR_RETRY_MS = 60_000

const PERSONAL_CHANNEL_PREFIX = 'personal:#'

export type RealtimeGrant = { enabled: false } | { enabled: true; url: string; token: string }

const OFF: RealtimeGrant = { enabled: false }

export function readRealtimeGrant(value: unknown): RealtimeGrant {
  if (!value || typeof value !== 'object') return OFF
  const v = value as Record<string, unknown>
  if (v.enabled !== true || typeof v.token !== 'string' || !v.token || typeof v.url !== 'string') return OFF
  let parsed: URL
  try {
    parsed = new URL(v.url)
  } catch {
    return OFF
  }
  // The token endpoint names the socket address; only our own host may receive the token.
  const ours =
    parsed.protocol === 'wss:' &&
    parsed.hostname === REALTIME_HOST &&
    !parsed.port &&
    !parsed.username &&
    !parsed.password
  return ours ? { enabled: true, url: parsed.href, token: v.token } : OFF
}

export function pokeTopic(channel: unknown, data: unknown): RealtimeTopic | null {
  if (typeof channel !== 'string' || !channel.startsWith(PERSONAL_CHANNEL_PREFIX)) return null
  if (!data || typeof data !== 'object') return null
  const t = (data as { t?: unknown }).t
  return (REALTIME_TOPICS as readonly unknown[]).includes(t) ? (t as RealtimeTopic) : null
}

export function friendsPollWait(live: boolean): 0 | 1 {
  return live ? 0 : 1
}

export function friendsPollDelayMs(
  live: boolean,
  serverMs: number,
  failures: number,
  hidden: boolean,
  random: () => number,
  waited: boolean,
): number {
  if (live) return pollDelayMs(REALTIME_FALLBACK_MS, failures, hidden, random)
  return pollDelayMs(serverMs, failures, hidden, random, waited)
}

export function refreshDue(live: boolean, lastAt: number, now: number): boolean {
  return !live || now - lastAt >= REALTIME_STRETCHED_MS
}

export interface PokeGate {
  poke: () => void
  take: () => boolean
}

/** Pokes arriving while a fetch is in flight collapse into one rerun after it. */
export function pokeGate(isBusy: () => boolean, fire: () => void): PokeGate {
  let queued = false
  return {
    poke: () => {
      if (isBusy()) {
        queued = true
        return
      }
      fire()
    },
    take: () => {
      const was = queued
      queued = false
      return was
    },
  }
}
