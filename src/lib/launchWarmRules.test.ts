import { expect, test } from 'bun:test'
import { MS_RENEW_AHEAD_MS, WARM_EVERY_MS, msTokenEndsSoon, warmDue } from './launchWarmRules'

const base = { profile: 'Мой мир', now: 1_000_000, last: undefined, launching: false, installing: false, hidden: false }

test('a build shown in the lobby is prepared once in ten minutes and never next to a launch or a download', () => {
  expect(warmDue(base)).toBe(true)
  expect(warmDue({ ...base, last: base.now - 60_000 }), 'a minute ago: not again').toBe(false)
  expect(warmDue({ ...base, last: base.now - WARM_EVERY_MS })).toBe(true)
  expect(warmDue({ ...base, launching: true }), 'Play is already under way').toBe(false)
  expect(warmDue({ ...base, installing: true }), 'a download takes the disk and the line').toBe(false)
  expect(warmDue({ ...base, hidden: true }), 'the window is not even seen').toBe(false)
  expect(warmDue({ ...base, profile: null }), 'nothing is picked').toBe(false)
})

test('only a Microsoft session about to end is renewed ahead of Play', () => {
  const now = 5_000_000
  expect(msTokenEndsSoon({ kind: 'microsoft', exp: now + 60_000 }, now)).toBe(true)
  expect(msTokenEndsSoon({ kind: 'microsoft', exp: now + MS_RENEW_AHEAD_MS + 1 }, now), 'plenty of time left').toBe(false)
  expect(msTokenEndsSoon({ kind: 'microsoft', exp: now - 1 }, now), 'an ended one is renewed by Play with its dialog').toBe(false)
  expect(msTokenEndsSoon({ kind: 'offline', exp: now + 60_000 }, now)).toBe(false)
  expect(msTokenEndsSoon(null, now)).toBe(false)
})
