import { expect, test } from 'bun:test'
import { CheckBackoff, FailureSeries, checkGapMs, isCriticalRelease } from './updatePolicy'

const releases: { raw: unknown; want: boolean; why: string }[] = [
  { raw: { version: '2.0.280', platforms: { 'windows-x86_64': { url: 'x' } } }, want: false, why: 'an ordinary release says nothing and is not critical' },
  { raw: { critical: true }, want: true, why: 'the manifest flags the whole release' },
  { raw: { critical: 'true' }, want: false, why: 'only a real boolean counts, a string from a typo does not close the launcher' },
  { raw: { platforms: { 'windows-x86_64': { critical: true }, 'darwin-aarch64': { critical: true } } }, want: true, why: 'every platform entry flagged' },
  { raw: { platforms: { 'windows-x86_64': { critical: true }, 'darwin-aarch64': {} } }, want: false, why: 'one system flagged does not make it critical for the rest' },
  { raw: { platforms: {} }, want: false, why: 'no platform entries, nothing flagged' },
  { raw: null, want: false, why: 'no document' },
  { raw: undefined, want: false, why: 'no document' },
  { raw: 'critical', want: false, why: 'not an object' },
]

test.each(releases)('isCriticalRelease: $why', ({ raw, want }) => {
  expect(isCriticalRelease(raw), 'a wrong answer either blocks every start on a download or skips an urgent fix').toBe(want)
})

const gaps: [number, number][] = [
  [0, 30],
  [1, 60],
  [2, 120],
  [3, 240],
  [4, 360],
  [5, 360],
  [40, 360],
  [-3, 30],
]

test.each(gaps)('after %d failed checks the next one waits %d minutes', (failures, minutes) => {
  expect(checkGapMs(failures)).toBe(minutes * 60_000)
})

test('failed checks push the next one back, a working one resets it', () => {
  const b = new CheckBackoff()
  const t0 = 1_000_000
  expect(b.allowed(t0)).toBe(true)
  b.failed(t0)
  expect(b.allowed(t0 + 59 * 60_000), 'one failure: the next check is in an hour, not in 30 minutes').toBe(false)
  expect(b.allowed(t0 + 60 * 60_000)).toBe(true)
  b.failed(t0 + 60 * 60_000)
  expect(b.allowed(t0 + 60 * 60_000 + 119 * 60_000)).toBe(false)
  expect(b.streak).toBe(2)
  b.worked()
  expect(b.allowed(t0 + 61 * 60_000), 'a check that worked clears the wait').toBe(true)
  expect(b.streak).toBe(0)
})

test('a series of failures is reported once, and a success starts it over', () => {
  const s = new FailureSeries()
  expect(s.first()).toBe(true)
  expect(s.first(), 'the same story again').toBe(false)
  expect(s.first()).toBe(false)
  s.ended()
  expect(s.first(), 'after a success a new failure is news').toBe(true)
})
