import type { DailyClaim, DailyStatus, DailyTrackDay, GrantedReward, Reward } from '../../lib/rubies'
import { ADVENT_DAYS } from './advent'
import { CHEST_NAME } from './rewards'
import { demoChests, pushDemoChest } from './demoTrack'
import type { ClaimTarget, Row } from './track'

/**
 * ТОЛЬКО DEV: новогодний календарь для демо-входа (`?preview=user&daily-advent=1`).
 * `&daily-day=1..31` — какой сегодня день декабря (по умолчанию 5),
 * `&daily-missed=3,7` — пропущенные дни (сгорели), `&daily-plus=1` — с подпиской.
 *
 * Награды здесь — ЗАГЛУШКИ по кругу, не настоящая таблица: дерево лаунчера
 * публичное, а сюрприз календаря живёт только в службе (docs/ADVENT.md).
 * Ответ устроен как у службы: незабранные клетки приходят пустыми,
 * содержимое — в `granted` ответа «Забрать» и дальше в забранной клетке.
 */

const exclusive = (rarity: 'UNCOMMON' | 'EPIC', name: string): Reward => ({
  kind: 'ITEM',
  rarity,
  item: { code: 'demo-advent-' + rarity.toLowerCase(), name, rarity, preview: null },
})

function hidden(n: number, row: Row): Reward[] {
  if (n === ADVENT_DAYS) return [row === 'plus' ? exclusive('EPIC', 'Демо: эпический эксклюзив') : exclusive('UNCOMMON', 'Демо: необычный эксклюзив')]
  const k = n % 5
  if (row === 'free') {
    if (k === 0) return [{ kind: 'CHEST', tier: n > 20 ? 'RARE' : 'COMMON' }]
    if (k === 3) return [{ kind: 'RUBIES', amount: 50 }]
    return [{ kind: 'SHARDS', amount: 20 + n }]
  }
  if (k === 0) return [{ kind: 'CHEST', tier: n > 20 ? 'EPIC' : 'RARE' }]
  if (k === 2) return [{ kind: 'FRAGMENTS', rarity: 'RARE', amount: 10 }]
  if (k === 3) return [{ kind: 'RUBIES', amount: 150 + n * 10 }]
  return [{ kind: 'SHARDS', amount: 60 + n * 2 }]
}

const key = (n: number, row: Row) => row + ':' + n
const state = { today: 0, missed: '', claimed: new Set<string>() }

/** Год демо-календаря: декабрь этого года. */
const startsAt = () => new Date(Date.UTC(new Date().getUTCFullYear(), 11, 1) - 3 * 3_600_000).toISOString()

export function demoAdventStatus(opts: { day?: number; missed?: number[]; plus?: boolean }): DailyStatus {
  const today = Math.min(ADVENT_DAYS, Math.max(1, opts.day || 5))
  const missed = new Set(opts.missed ?? [])
  const sig = today + '|' + [...missed].join(',')
  if (state.today !== today || state.missed !== sig) {
    state.today = today
    state.missed = sig
    state.claimed = new Set()
    for (let n = 1; n < today; n++) {
      if (missed.has(n)) continue
      state.claimed.add(key(n, 'free'))
      if (opts.plus) state.claimed.add(key(n, 'plus'))
    }
  }
  const plus = !!opts.plus
  const chain = (row: Row) => Array.from({ length: ADVENT_DAYS - 1 }, (_, i) => state.claimed.has(key(i + 1, row))).every(Boolean)
  const cellState = (n: number, row: Row): DailyTrackDay['freeState'] => {
    if (state.claimed.has(key(n, row))) return 'claimed'
    if (row === 'plus' && !plus) return 'locked'
    if (n < today) return 'missed'
    if (n > today) return 'future'
    return n === ADVENT_DAYS && !chain(row) ? 'missed' : 'ready'
  }
  const track: DailyTrackDay[] = Array.from({ length: ADVENT_DAYS }, (_, i) => {
    const n = i + 1
    const freeState = cellState(n, 'free')
    const plusState = cellState(n, 'plus')
    return {
      day: n,
      free: freeState === 'claimed' ? hidden(n, 'free') : [],
      plus: plusState === 'claimed' ? hidden(n, 'plus') : [],
      freeState,
      plusState,
    }
  })
  const start = startsAt()
  // Демо живёт не в декабре: следующая клетка — в ближайшую полночь МСК от «сейчас».
  const msk = Date.now() + 3 * 3_600_000
  const nextMidnight = new Date(Math.floor(msk / 86_400_000 + 1) * 86_400_000 - 3 * 3_600_000).toISOString()
  const anyReady = track.some((d) => d.freeState === 'ready' || d.plusState === 'ready')
  return {
    claimedToday: !anyReady,
    streak: today,
    cycleDay: 1,
    todayRubies: 0,
    todayChest: null,
    graceLeft: 0,
    plus,
    plusMultiplier: 1,
    cycle: [],
    track,
    weekItem: null,
    chests: demoChests(),
    nextAt: nextMidnight,
    season: {
      id: 'advent-demo',
      kind: 'advent',
      day: today,
      startsAt: start,
      endsAt: new Date(Date.parse(start) + ADVENT_DAYS * 86_400_000).toISOString(),
      nextUnlockAt: nextMidnight,
      // Итоги — те же, что обещает задача на декабрь (их видно и в плитке PLUS).
      totals: {
        free: { shards: 600, rubies: 250, chests: { COMMON: 2, RARE: 1, EPIC: 1 } },
        plus: { shards: 1000, rubies: 2100, chests: { RARE: 3, EPIC: 4, LEGEND: 1 } },
      },
    },
  }
}

/** «Забрать» календаря: только сегодняшняя клетка; PLUS без подписки — 403, как у службы. */
export function demoAdventClaim(status: DailyStatus, balance: number, target?: ClaimTarget | null): DailyClaim {
  const track = status.track || []
  const cells: { day: number; row: Row }[] = []
  const ready = (d: DailyTrackDay, row: Row) => (row === 'free' ? d.freeState : d.plusState) === 'ready'
  if (target && target !== 'all') {
    if (target.row === 'plus' && !status.plus) throw new Error('403: строка PLUS — только с подпиской')
    const d = track[target.day - 1]
    if (!d || !ready(d, target.row)) throw new Error('409: этот день уже не открыть')
    cells.push(target)
  } else track.forEach((d) => (['free', 'plus'] as const).forEach((row) => ready(d, row) && cells.push({ day: d.day, row })))
  const granted: GrantedReward[] = []
  for (const c of cells) {
    for (const r of hidden(c.day, c.row)) {
      if (r.kind === 'CHEST') {
        const chest = pushDemoChest({
          tier: r.tier,
          source: c.row === 'plus' ? 'DAILY_PLUS' : 'DAILY',
          title: CHEST_NAME[r.tier] + ' сундук',
          createdAt: new Date().toISOString(),
          day: c.day,
        })
        granted.push({ ...r, source: c.row, day: c.day, chestId: chest.id })
      } else granted.push({ ...r, source: c.row, day: c.day, ...(r.kind === 'FRAGMENTS' && c.day >= 25 ? { unlocked: true } : {}) })
    }
    state.claimed.add(key(c.day, c.row))
  }
  const next = demoAdventStatus({ day: status.season?.day, plus: !!status.plus, missed: state.missed.split('|')[1]?.split(',').filter(Boolean).map(Number) })
  const gained = granted.reduce((n, r) => n + (r.kind === 'RUBIES' ? r.amount : 0), 0)
  return { ...next, gained, chestId: [...granted].reverse().find((g) => g.chestId)?.chestId ?? null, balance: balance + gained, granted }
}
