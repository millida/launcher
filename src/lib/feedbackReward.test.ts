import { describe, expect, it } from 'bun:test'
import { FEEDBACK_WEEK_MS, rewardOpensAt, rewardReady } from './feedbackReward'

const NOW = Date.parse('2026-10-02T12:00:00Z')

/// Input -> verdict. The badge is computed from the last answer instead of asking
/// the server on every sidebar render, so the date read here decides it for a week.
describe('rewardOpensAt', () => {
  const cases: Array<[string, boolean, string | undefined, number]> = [
    ['награда доступна — открыта сейчас', true, undefined, NOW],
    ['сервер назвал дату', false, '2026-10-05T00:00:00Z', Date.parse('2026-10-05T00:00:00Z')],
    ['сервер не назвал дату — неделя', false, undefined, NOW + FEEDBACK_WEEK_MS],
    ['битая дата — неделя, а не «доступно сейчас»', false, 'завтра', NOW + FEEDBACK_WEEK_MS],
  ]
  for (const [name, ready, nextAt, want] of cases) {
    it(name, () => {
      expect(rewardOpensAt(ready, nextAt, NOW)).toBe(want)
    })
  }
})

describe('rewardReady', () => {
  const opens = Date.parse('2026-10-05T00:00:00Z')
  const cases: Array<[string, number, boolean]> = [
    ['до даты — нет', opens - 1, false],
    ['в момент даты — да, без нового запроса', opens, true],
    ['после даты — да', opens + 60_000, true],
  ]
  for (const [name, now, want] of cases) {
    it(name, () => {
      expect(rewardReady(opens, now)).toBe(want)
    })
  }
})
