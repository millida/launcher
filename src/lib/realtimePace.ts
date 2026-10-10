import { pollDelayMs } from './pollPace'
import { readPresencePush, readTypingPush } from './friendsPush'

export const REALTIME_TOPICS = ['friends', 'presence', 'calls', 'inbox', 'hosting', 'account', 'party'] as const
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number]

export const REALTIME_HOST = 'api.millida.net'
export const REALTIME_SOCKET_URL = 'wss://' + REALTIME_HOST + '/v2/realtime/connection/websocket'
export const REALTIME_CLIENT_NAME = 'launcher'
export const REALTIME_OFF_RETRY_MS = 600_000
export const REALTIME_ERROR_RETRY_MS = 60_000
/** A purchase wait is short and rare; this only covers a server that does not announce the grant yet. */
export const PURCHASE_LIVE_SAFETY_MS = 60_000

const PERSONAL_CHANNEL_PREFIX = 'personal:#'
const PRESENCE_CHANNEL_PREFIX = 'lp:'

/** `presence`: the server counts this launcher online from the socket, so the HTTP beat timer may stop. */
export type RealtimeGrant = { enabled: false } | { enabled: true; url: string; token: string; presence: boolean }

const OFF: RealtimeGrant = { enabled: false }

export function readRealtimeGrant(value: unknown): RealtimeGrant {
  if (!value || typeof value !== 'object') return OFF
  const v = value as Record<string, unknown>
  if (v.enabled !== true || typeof v.token !== 'string' || !v.token || typeof v.url !== 'string') return OFF
  const url = ownSocketUrl(v.url)
  return url ? { enabled: true, url, token: v.token, presence: v.presence === true } : OFF
}

/** The socket address, or null when it points anywhere but our own host over TLS. */
export function ownSocketUrl(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  // The token endpoint names the socket address; only our own host may receive the token.
  const ours =
    parsed.protocol === 'wss:' &&
    parsed.hostname === REALTIME_HOST &&
    !parsed.port &&
    !parsed.username &&
    !parsed.password
  return ours ? parsed.href : null
}

export interface RealtimeClientInfo {
  installId?: string | null
  version?: string | null
  os?: string | null
}

const INSTALL_ID = /^[A-Za-z0-9_-]{8,64}$/
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/
const OSES: readonly unknown[] = ['windows', 'macos', 'linux']

/** The server drops a malformed parameter silently, so a bad one is not sent at all. */
export function realtimeTokenPath(info: RealtimeClientInfo): string {
  const q = new URLSearchParams()
  if (info.installId && INSTALL_ID.test(info.installId)) q.set('installId', info.installId)
  if (info.version && VERSION.test(info.version)) q.set('v', info.version)
  if (OSES.includes(info.os)) q.set('os', info.os as string)
  const s = q.toString()
  return '/realtime/token' + (s ? '?' + s : '')
}

export function pokeTopic(channel: unknown, data: unknown): RealtimeTopic | null {
  if (typeof channel !== 'string' || !channel.startsWith(PERSONAL_CHANNEL_PREFIX)) return null
  if (!data || typeof data !== 'object') return null
  const t = (data as { t?: unknown }).t
  return (REALTIME_TOPICS as readonly unknown[]).includes(t) ? (t as RealtimeTopic) : null
}

/** Whether the publication carries its change, so listeners that only refetch can stay quiet. */
export function carriesData(topic: RealtimeTopic, data: unknown): boolean {
  if (topic === 'presence') return !!readPresencePush(data)
  if (topic === 'friends') return !!readTypingPush(data)
  return false
}

export interface ServerSub {
  channel: string
  recovered: boolean
}

/** The server turned socket presence off for this launcher: back to the HTTP beat at once. */
export function presenceRollback(channel: unknown, data: unknown): boolean {
  if (typeof channel !== 'string' || !channel.startsWith(PRESENCE_CHANNEL_PREFIX)) return false
  if (!data || typeof data !== 'object') return false
  const d = data as { t?: unknown; presence?: unknown }
  return d.t === 'realtime' && d.presence === false
}

export type PresenceModeEvent = { kind: 'grant'; presence: boolean } | { kind: 'rollback' }

/**
 * Socket presence is re-decided by every token grant, because the rollout share
 * changes on the server at any time; a rollback publication ends it until a
 * later grant says otherwise.
 */
export function presenceModeAfter(event: PresenceModeEvent): boolean {
  return event.kind === 'grant' && event.presence
}

/** The HTTP beat timer may stop only while the socket is up and the latest grant allowed socket presence. */
export function socketPresence(live: boolean, mode: boolean): boolean {
  return live && mode
}

/** A personal channel that replayed what was missed needs no catch-up fetch. */
export function needsCatchUp(subs: ServerSub[]): boolean {
  const personal = subs.find((s) => s.channel.startsWith(PERSONAL_CHANNEL_PREFIX))
  return !personal || !personal.recovered
}

/** One call per listener even when it listens to several topics: the catch-up is a single pass. */
export function catchUpListeners<T>(groups: Iterable<Iterable<T>>): T[] {
  const seen = new Set<T>()
  for (const group of groups) for (const h of group) seen.add(h)
  return [...seen]
}

export const RELAY_TOPICS: readonly RealtimeTopic[] = ['friends', 'presence']

export type RelayMessage =
  | { kind: 'live'; live: boolean }
  | { kind: 'pub'; topic: RealtimeTopic; data: unknown }
  | { kind: 'catchup' }

export function readRelayMessage(value: unknown): RelayMessage | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.kind === 'live') return typeof v.live === 'boolean' ? { kind: 'live', live: v.live } : null
  if (v.kind === 'catchup') return { kind: 'catchup' }
  if (v.kind === 'pub' && RELAY_TOPICS.includes(v.topic as RealtimeTopic) && v.data && typeof v.data === 'object')
    return { kind: 'pub', topic: v.topic as RealtimeTopic, data: v.data }
  return null
}

export function friendsPollWait(live: boolean): 0 | 1 {
  return live ? 0 : 1
}

/** Null: no timer, the next poll waits for a publication. A failed poll still retries with backoff. */
export function friendsPollDelayMs(
  live: boolean,
  serverMs: number,
  failures: number,
  hidden: boolean,
  random: () => number,
  waited: boolean,
): number | null {
  if (live) return failures > 0 ? pollDelayMs(serverMs, failures, hidden, random) : null
  return pollDelayMs(serverMs, failures, hidden, random, waited)
}

/** Null while the socket is live: the topic's publication is the only trigger. */
export function realtimePaceMs(live: boolean, ms: number): number | null {
  return live ? null : ms
}

export function purchaseWaitMs(live: boolean, everyMs: number): number {
  return live ? Math.max(everyMs, PURCHASE_LIVE_SAFETY_MS) : everyMs
}

export function refreshDue(live: boolean): boolean {
  return !live
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

const LOGIN_CHANNEL = /^login:[0-9a-f]{32}$/
/** While the approval can arrive by socket, the code is still checked this often in case the push is lost. */
export const LOGIN_SAFETY_POLL_MS = 15_000

export function readLoginChannel(value: unknown): string | null {
  return typeof value === 'string' && LOGIN_CHANNEL.test(value) ? value : null
}

export function loginPushed(channel: string, pubChannel: unknown, data: unknown): boolean {
  return pubChannel === channel && !!data && typeof data === 'object' && (data as { t?: unknown }).t === 'login'
}

export function loginPollDelayMs(subscribed: boolean, intervalMs: number): number {
  return subscribed ? Math.max(intervalMs, LOGIN_SAFETY_POLL_MS) : intervalMs
}
