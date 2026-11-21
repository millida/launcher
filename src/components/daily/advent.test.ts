import { describe, expect, test } from 'bun:test'
import type { DailyCellState, DailyTrackDay } from '../../lib/rubies'
import { ADVENT_DAYS, adventChain, adventCols, adventDate, adventWeekend, isAdvent } from './advent'
import { passCols, readyCells, type DailyView } from './track'

const START = '2026-11-30T21:00:00.000Z' // 01.12.2026 00:00 МСК

function status(day: number, cells: Partial<DailyTrackDay>[] = [], plus = false): DailyView {
  const track: DailyTrackDay[] = Array.from({ length: ADVENT_DAYS }, (_, i) => ({ day: i + 1, free: [], plus: [], ...cells[i] }))
  return {
    claimedToday: false,
    streak: day,
    cycleDay: 1,
    todayRubies: 0,
    todayChest: null,
    graceLeft: 0,
    plus,
    cycle: [],
    track,
    season: { id: 'advent-2026', kind: 'advent', day, startsAt: START, endsAt: '2026-12-31T21:00:00.000Z', nextUnlockAt: START },
  }
}

const st = (free: DailyCellState, plusState: DailyCellState = free): Partial<DailyTrackDay> => ({ freeState: free, plusState })

describe('новогодний календарь', () => {
  test('сезон календаря узнаётся по kind, обычный пропуск — нет', () => {
    expect(isAdvent(status(1))).toBe(true)
    expect(isAdvent({ ...status(1), season: { id: 's', day: 1, endsAt: START, nextUnlockAt: START } })).toBe(false)
  })

  test('31 клетка, декабрь 2026 начинается во вторник, 5–6 декабря — выходные', () => {
    const s = status(1)
    expect(passCols(s, true)).toHaveLength(ADVENT_DAYS)
    expect(adventDate(s.season, 1).getUTCDay()).toBe(2)
    expect(adventDate(s.season, 31).toISOString().slice(0, 10)).toBe('2026-12-31')
    expect([4, 5, 6, 7].map((n) => adventWeekend(s.season, n))).toEqual([false, true, true, false])
  })

  test('без начала сезона дата — 1 декабря года, в котором кончается сезон', () => {
    expect(adventDate({ endsAt: '2026-12-31T21:00:00.000Z' }, 1).toISOString().slice(0, 10)).toBe('2026-12-01')
  })

  test('содержимое незабранной клетки не показывается, даже если служба его прислала', () => {
    const leak = { free: [{ kind: 'SHARDS' as const, amount: 99 }], plus: [{ kind: 'RUBIES' as const, amount: 500 }] }
    const cols = passCols(status(3, [{ ...st('claimed'), ...leak }, { ...st('missed'), ...leak }, { ...st('ready'), ...leak }, { ...st('future'), ...leak }], true), true)
    expect(cols[0]!.free).toEqual(leak.free)
    expect(cols[0]!.plus).toEqual(leak.plus)
    for (const c of cols.slice(1, 4)) {
      expect(c.free).toEqual([])
      expect(c.plus).toEqual([])
    }
  })

  test('без состояний от службы: прошлое сгорело, сегодня открыто, дальше закрыто', () => {
    const cols = adventCols(status(5), true)
    expect(cols.slice(0, 6).map((c) => c.freeState)).toEqual(['missed', 'missed', 'missed', 'missed', 'ready', 'future'])
    expect(readyCells(cols)).toEqual([
      { day: 5, row: 'free' },
      { day: 5, row: 'plus' },
    ])
  })

  test('31-я клетка по догадке клиента не открывается: цепочку знает служба', () => {
    expect(adventCols(status(31), true)[30]!.freeState).toBe('missed')
  })

  test('строка PLUS без подписки — под замком, но сгоревшее и забранное видно как есть', () => {
    const cols = adventCols(status(4, [st('claimed', 'claimed'), st('missed', 'missed'), st('claimed', 'locked'), st('ready', 'locked')]), false)
    expect(cols.slice(0, 5).map((c) => c.plusState)).toEqual(['claimed', 'missed', 'missed', 'locked', 'locked'])
  })

  test('цепочка к 31-й: рвёт только сгоревшая клетка, будущие дни её не рвут', () => {
    const all = adventCols(status(10, Array.from({ length: 9 }, () => st('claimed'))), true)
    expect(adventChain(all, 'free')).toEqual({ got: 9, intact: true })
    const broken = adventCols(status(10, [st('claimed'), st('missed'), ...Array.from({ length: 7 }, () => st('claimed'))]), true)
    expect(adventChain(broken, 'free')).toEqual({ got: 8, intact: false })
  })
})
