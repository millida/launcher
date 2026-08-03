import type { ChatMessage } from '../state/friends'

/// Consecutive messages from one side within a couple of minutes read as a
/// single utterance; repeating the timestamp on each line is only noise.
export const GROUP_GAP_MS = 120_000

export const dayKey = (ts?: number) => (ts ? new Date(ts).toDateString() : '')

export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function isGrouped(msgs: ChatMessage[], i: number): boolean {
  const prev = msgs[i - 1]
  const cur = msgs[i]
  if (!prev || !cur) return false
  if (!!prev.me !== !!cur.me) return false
  if (dayKey(prev.ts) !== dayKey(cur.ts)) return false
  return (cur.ts || 0) - (prev.ts || 0) < GROUP_GAP_MS
}

/// A message counts as read only once the peer's read mark is not older than
/// it. An optimistic local message has no server timestamp yet and must never
/// be painted as read.
export function isRead(m: ChatMessage, peerReadAt: number): boolean {
  return !!m.me && !m.state && !!m.ts && m.ts <= peerReadAt
}
