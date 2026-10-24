import { describe, expect, test } from 'bun:test'
import { dayPhase, seasonOf } from './ambience'

const at = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h)

describe('lobby ambience calendar', () => {
  const seasons: Array<[string, Date, ReturnType<typeof seasonOf>]> = [
    ['Halloween week starts on the 20th of October', at(10, 20), 'halloween'],
    ['and lasts through the 2nd of November', at(11, 2), 'halloween'],
    ['ordinary November has nothing', at(11, 15), null],
    ['snow from the 10th of December', at(12, 10), 'winter'],
    ['New Year fireworks win over snow on the 31st', at(12, 31), 'newyear'],
    ['fireworks end after the 2nd of January', at(1, 3), 'winter'],
    ['snow ends after the 20th of January', at(1, 21), null],
  ]
  for (const [why, date, want] of seasons) test(why, () => expect(seasonOf(date)).toBe(want))

  const phases: Array<[number, ReturnType<typeof dayPhase>]> = [
    [4, 'night'],
    [5, 'dawn'],
    [8, 'day'],
    [17, 'day'],
    [18, 'dusk'],
    [21, 'night'],
  ]
  for (const [h, want] of phases) test(`${h}:00 is ${want}`, () => expect(dayPhase(at(6, 1, h))).toBe(want))
})
