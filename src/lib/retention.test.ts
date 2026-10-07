import { describe, expect, it } from 'bun:test'
import { chestTimerText, isDayZero, keepWeek, mskDay, reminderDue, toMskMidnight } from './retention'
import { playHoursLabel, playTier } from './playTiers'

/** 2026-10-06 в hh:mm по Москве. */
const msk = (hh: number, mm = 0, day = 6) => Date.UTC(2026, 9, day, hh - 3, mm)

describe('часы на кнопке «Играть»', () => {
  it('с нуля: 0 ч, минуты, потом часы', () => {
    expect(playHoursLabel(0)).toBe('0 ч')
    expect(playHoursLabel(59)).toBe('0 ч')
    expect(playHoursLabel(12 * 60 + 5)).toBe('12 мин')
    expect(playHoursLabel(3599)).toBe('59 мин')
    expect(playHoursLabel(47 * 3600 + 1800)).toBe('47 ч')
  })
  it('ступень растёт по часам', () => {
    expect(playTier(0).reached).toBe(0)
    expect(playTier(47 * 3600)).toMatchObject({ reached: 2, next: 50 })
  })
})

describe('таймер сундука', () => {
  it('часы:минуты, в последний час минуты:секунды', () => {
    expect(chestTimerText((2 * 60 + 14) * 60_000 + 30_000)).toBe('2:14')
    expect(chestTimerText(4 * 60_000 + 5_000)).toBe('4:05')
    expect(chestTimerText(0)).toBe('0:00')
  })
})

describe('напоминание «серия сгорит»', () => {
  const base = { ready: true, enabled: true, shown: [] as number[] }
  it('за 3 часа до московской полуночи и не раньше', () => {
    expect(toMskMidnight(msk(21))).toBe(3 * 3_600_000)
    expect(reminderDue({ ...base, now: msk(20, 59) })).toBe(false)
    expect(reminderDue({ ...base, now: msk(21) })).toBe(true)
    expect(reminderDue({ ...base, now: msk(23, 50) })).toBe(true)
    expect(reminderDue({ ...base, now: msk(0, 30, 7) })).toBe(false)
  })
  it('только если бонус не забран и тумблер включён', () => {
    expect(reminderDue({ ...base, ready: false, now: msk(22) })).toBe(false)
    expect(reminderDue({ ...base, enabled: false, now: msk(22) })).toBe(false)
  })
  it('не чаще раза в сутки и трёх раз в неделю', () => {
    expect(reminderDue({ ...base, shown: [msk(21, 5)], now: msk(22) })).toBe(false)
    expect(reminderDue({ ...base, shown: [msk(21, 5, 5)], now: msk(22) })).toBe(true)
    const three = [msk(21, 0, 3), msk(21, 0, 4), msk(21, 0, 5)]
    expect(reminderDue({ ...base, shown: three, now: msk(22) })).toBe(false)
    expect(reminderDue({ ...base, shown: three, now: msk(22, 0, 10) })).toBe(true)
    expect(mskDay(msk(23, 59))).toBe(mskDay(msk(0, 0)))
  })
  it('журнал держит только неделю', () => {
    const now = msk(22)
    expect(keepWeek([now - 8 * 86_400_000, now - 86_400_000], now)).toEqual([now - 86_400_000])
  })
})

describe('первый день', () => {
  it('ни одной игры — первый день; идёт установка или запуск — нет', () => {
    expect(isDayZero({ loaded: true, total_seconds: 0, sessions: 0 }, false)).toBe(true)
    expect(isDayZero({ loaded: false, total_seconds: 0, sessions: 0 }, false)).toBe(false)
    expect(isDayZero({ loaded: true, total_seconds: 0, sessions: 0 }, true)).toBe(false)
    expect(isDayZero({ loaded: true, total_seconds: 40, sessions: 1 }, false)).toBe(false)
  })
})

describe('день серии: только окно или игра', () => {
  const day = (h: number) => Date.UTC(2026, 9, 6, h - 3)
  it('10 секунд окна на экране — засчитан; трей — нет', async () => {
    const { shouldCountDay } = await import('./retention')
    const now = day(15)
    expect(shouldCountDay({ now, focusedSince: null, gameStarted: false, sentDay: null })).toBe(false)
    expect(shouldCountDay({ now, focusedSince: now - 9_000, gameStarted: false, sentDay: null })).toBe(false)
    expect(shouldCountDay({ now, focusedSince: now - 10_000, gameStarted: false, sentDay: null })).toBe(true)
    expect(shouldCountDay({ now, focusedSince: null, gameStarted: true, sentDay: null })).toBe(true)
  })
  it('раз в московские сутки', async () => {
    const { shouldCountDay } = await import('./retention')
    const { mskDay } = await import('./retention')
    const now = day(23)
    expect(shouldCountDay({ now, focusedSince: 0, gameStarted: true, sentDay: mskDay(now) })).toBe(false)
    expect(shouldCountDay({ now: now + 2 * 3_600_000, focusedSince: 0, gameStarted: false, sentDay: mskDay(now) })).toBe(true)
  })
})
