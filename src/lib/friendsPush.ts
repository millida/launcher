import type { Friend } from '../state/friends'

export type PushedStatus = 'online' | 'playing' | 'offline'

export interface PresencePush {
  id: string
  status: PushedStatus
  server: string | null
  at: number
}

export interface TypingPush {
  from: string
  until: number
}

const STATUSES: readonly unknown[] = ['online', 'playing', 'offline']

/** Matches the server's typing box TTL; used when the two clocks disagree too much to trust `until`. */
export const TYPING_FALLBACK_MS = 6_000
const TYPING_MAX_MS = 10_000

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

export function readPresencePush(data: unknown): PresencePush | null {
  const u = record(record(data)?.u)
  if (!u) return null
  if (typeof u.id !== 'string' || !u.id || !STATUSES.includes(u.status)) return null
  if (u.server !== null && u.server !== undefined && typeof u.server !== 'string') return null
  const at = typeof u.at === 'number' && Number.isFinite(u.at) ? u.at : Date.now()
  return { id: u.id, status: u.status as PushedStatus, server: (u.server as string | null | undefined) || null, at }
}

export function readTypingPush(data: unknown): TypingPush | null {
  const t = record(record(data)?.typing)
  if (!t || typeof t.from !== 'string' || !t.from) return null
  if (typeof t.until !== 'number' || !Number.isFinite(t.until)) return null
  return { from: t.from, until: t.until }
}

/**
 * The friend list after a pushed status, or null when the push cannot be applied
 * faithfully and the list has to be fetched. The push carries no server address,
 * build or site presence, so only a return to the launcher lobby is rebuilt
 * locally; anything else would show a card without its join button or with a
 * wrong "where".
 */
export function withPresence(list: Friend[], u: PresencePush): Friend[] | null {
  const i = list.findIndex((f) => f.userId === u.id)
  if (i < 0) return null
  const f = list[i]
  let next: Friend
  if (u.status === 'online') {
    next = { ...f, online: true, playing: false, place: 'launcher', text: 'В лаунчере', lastSeen: u.at }
    delete next.serverIp
    delete next.serverName
    delete next.build
    delete next.gameNick
  } else if (u.status === 'playing' && f.playing && (f.serverName || null) === u.server) {
    next = { ...f, lastSeen: u.at }
  } else {
    return null
  }
  const out = list.slice()
  out[i] = next
  return out
}

export function typingHoldMs(until: number, now: number): number {
  const left = until - now
  return left > 0 && left <= TYPING_MAX_MS ? left : TYPING_FALLBACK_MS
}
