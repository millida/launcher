import type { Friend } from './friends'

const MAX_NAMED = 2

export function presenceTitle(list: Friend[]): string {
  const names = list.map((f) => f.nickname || 'Друг')
  if (names.length === 1) return names[0]
  const shown = names.slice(0, MAX_NAMED).join(', ')
  return names.length > MAX_NAMED ? shown + ' и ещё ' + (names.length - MAX_NAMED) : shown
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function presenceText(list: Friend[], kind: 'play' | 'online'): string {
  if (list.length > 1) {
    const word = plural(list.length, 'друг', 'друга', 'друзей')
    return list.length + ' ' + word + (kind === 'play' ? ' в игре' : ' в сети')
  }
  const f = list[0]
  if (kind === 'online') return 'В сети'
  const where = f.serverName || f.serverIp || f.build || ''
  return where ? 'Играет · ' + where : 'Зашёл в игру'
}

/// Сколько одна игровая сессия друга держится в памяти: карточку «зашёл в игру»
/// он получает один раз за неё. Присутствие мигает по причинам, не связанным с
/// игрой (опоздал стук лаунчера, свернули окно), и каждое такое мигание читалось
/// как новый заход — друзьям приходила та же карточка по второму и третьему разу.
const REPEAT_MS = 10 * 60_000

export interface PresenceMemo {
  playing: Map<string, number>
  online: Map<string, number>
}

export const createPresenceMemo = (): PresenceMemo => ({ playing: new Map(), online: new Map() })

function fresh(memo: Map<string, number>, userId: string, at: number): boolean {
  const ts = memo.get(userId)
  return ts !== undefined && at - ts < REPEAT_MS
}

function remember(memo: Map<string, number>, list: Friend[], at: number) {
  const live = new Set(list.map((f) => f.userId))
  for (const f of list) memo.set(f.userId, at)
  for (const [userId, ts] of memo) if (!live.has(userId) && at - ts >= REPEAT_MS) memo.delete(userId)
}

/// Going online and starting a game inside one poll tick is one event: without
/// this a friend who launched the game got both cards at once.
export function presenceEvents(
  before: Friend[],
  now: Friend[],
  memo?: PresenceMemo,
  at = Date.now(),
): { started: Friend[]; cameOnline: Friend[] } {
  const wasPlaying = new Map(before.map((f) => [f.userId, !!f.playing]))
  const wasOnline = new Map(before.map((f) => [f.userId, !!f.online]))
  const started = now.filter(
    (f) => f.playing && wasPlaying.get(f.userId) === false && !(memo && fresh(memo.playing, f.userId, at)),
  )
  const startedIds = new Set(started.map((f) => f.userId))
  // Presence on the site alone is a token hitting the API, not a person opening
  // the launcher, so it must not ring for anyone.
  const cameOnline = now.filter(
    (f) =>
      f.online &&
      f.place !== 'web' &&
      wasOnline.get(f.userId) === false &&
      !startedIds.has(f.userId) &&
      !(memo && fresh(memo.online, f.userId, at)),
  )
  if (memo) {
    remember(
      memo.playing,
      now.filter((f) => f.playing),
      at,
    )
    remember(
      memo.online,
      now.filter((f) => f.online && f.place !== 'web'),
      at,
    )
  }
  return { started, cameOnline }
}
