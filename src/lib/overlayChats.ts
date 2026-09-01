import { plural } from './format'
import type { Friend } from '../state/friends'
import type { Room } from '../state/rooms'

export interface OverlayChatItem {
  key: string
  id: string
  room: boolean
  title: string
  subtitle: string
  nicks: string[]
  unread: number
  ts: number
  online: boolean
  playing: boolean
}

export const chatKey = (id: string, room: boolean): string => (room ? 'r:' : 'u:') + id

const norm = (s: string) => s.trim().toLowerCase()

/// The rail is one list, not two: a group and a friend compete for the same
/// attention, and the answer to "who wrote last" cannot live in two columns.
function order(a: OverlayChatItem, b: OverlayChatItem): number {
  if (!!a.unread !== !!b.unread) return a.unread ? -1 : 1
  if (a.ts !== b.ts) return b.ts - a.ts
  if (a.online !== b.online) return a.online ? -1 : 1
  return a.title.localeCompare(b.title, 'ru')
}

export function chatItems(friends: Friend[], rooms: Room[], filter = ''): OverlayChatItem[] {
  const items: OverlayChatItem[] = []
  for (const f of friends) {
    const title = f.nickname || ''
    items.push({
      key: chatKey(f.userId, false),
      id: f.userId,
      room: false,
      title,
      subtitle: f.text || (f.online ? 'В сети' : ''),
      nicks: [title],
      unread: f.unread || 0,
      ts: f.lastMessageAt || 0,
      online: !!f.online,
      playing: !!f.playing,
    })
  }
  for (const r of rooms) {
    const inVoice = r.voice?.length || 0
    items.push({
      key: chatKey(r.id, true),
      id: r.id,
      room: true,
      title: r.title,
      subtitle: inVoice
        ? inVoice + ' в голосовом'
        : r.members.length + ' ' + plural(r.members.length, 'участник', 'участника', 'участников'),
      nicks: r.members.map((m) => m.nickname).slice(0, 3),
      unread: r.unread || 0,
      ts: r.lastMessageAt || 0,
      online: inVoice > 0,
      playing: false,
    })
  }
  const needle = norm(filter)
  const shown = needle ? items.filter((i) => norm(i.title).includes(needle)) : items
  return shown.sort(order)
}

/// The rail shows one column for time, so it says the most useful thing that
/// fits: today the clock, yesterday the word, and a date once neither helps.
export function chatWhen(ts: number, now = Date.now()): string {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === yesterday.toDateString()) return 'вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

export const unreadOf = (items: OverlayChatItem[]): number => items.reduce((n, i) => n + i.unread, 0)
