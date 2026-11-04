import { pollDelayMs } from './pollPace'
import { readPresencePush, readRoomTypingPush, readTypingPush } from './friendsPush'

export const REALTIME_TOPICS = ['friends', 'presence', 'calls', 'inbox', 'hosting', 'account', 'party', 'rooms'] as const
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
  if (topic === 'rooms') return !!readRoomTypingPush(data)
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

/** While the socket is live a publication drives the refetch; this only covers a publication that got lost. */
export const SAFETY_POLL_MS = 120_000
export const HIDDEN_SAFETY_FACTOR = 4

export function safetyPollMs(hidden: boolean): number {
  return hidden ? SAFETY_POLL_MS * HIDDEN_SAFETY_FACTOR : SAFETY_POLL_MS
}

/** Live: the safety interval with spread. A failed poll still retries with backoff. */
export function friendsPollDelayMs(
  live: boolean,
  serverMs: number,
  failures: number,
  hidden: boolean,
  random: () => number,
  waited: boolean,
): number {
  if (live) {
    if (failures > 0) return pollDelayMs(serverMs, failures, hidden, random)
    return Math.round(safetyPollMs(hidden) * (0.8 + random() * 0.4))
  }
  return pollDelayMs(serverMs, failures, hidden, random, waited)
}

/** Whether a timer tick should refetch: always without the socket, as before; live only once the safety interval passed. */
export function safetyDue(live: boolean, hidden: boolean, sinceLastMs: number): boolean {
  return !live || sinceLastMs >= safetyPollMs(hidden)
}

export const PARTY_POLL_MS = 15_000
export const PARTY_SLOW_POLL_MS = 60_000
/** Every party change is published to its members, so with the socket up the poll only catches a lost one. */
export const PARTY_LIVE_SAFETY_MS = 600_000

/** Null: skip this tick. Without the socket the cadence is the old one: 15 s with a party or an invite, 60 s otherwise. */
export function partyPollEveryMs(live: boolean, busy: boolean, hidden: boolean): number | null {
  if (hidden && !busy) return null
  if (live) return hidden ? PARTY_LIVE_SAFETY_MS * HIDDEN_SAFETY_FACTOR : PARTY_LIVE_SAFETY_MS
  return busy ? PARTY_POLL_MS : PARTY_SLOW_POLL_MS
}

export interface PartyRev {
  id: string
  rev: number
}

/** A reply about the same party with a lower rev was built before a change this client already applied. */
export function staleParty(applied: PartyRev | null, incoming: PartyRev | null): boolean {
  if (!applied || !incoming || applied.id !== incoming.id) return false
  return Number.isFinite(incoming.rev) && Number.isFinite(applied.rev) && incoming.rev < applied.rev
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

export interface SafetyRefresh {
  poke: () => void
  tick: () => void
}

export interface SafetyRefreshOptions {
  load: () => Promise<unknown>
  /** False skips the run entirely, e.g. the screen that shows the data is not open. */
  allowed: () => boolean
  live: () => boolean
  hidden: () => boolean
  now?: () => number
}

/**
 * Refetch on pokes and on a timer tick. A poke during a run collapses into one rerun
 * after it, so a reply started before the change never stays the last word.
 */
export function safetyRefresh(opts: SafetyRefreshOptions): SafetyRefresh {
  const now = opts.now ?? Date.now
  let busy = false
  let last = now()
  const run = () => {
    if (!opts.allowed()) return
    busy = true
    last = now()
    void opts
      .load()
      .catch((e) => console.warn('[realtime] refresh failed', e))
      .finally(() => {
        busy = false
        if (gate.take()) gate.poke()
      })
  }
  const gate = pokeGate(() => busy, run)
  return {
    poke: gate.poke,
    tick: () => {
      if (!busy && safetyDue(opts.live(), opts.hidden(), now() - last)) run()
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
