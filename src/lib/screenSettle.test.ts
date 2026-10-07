import { expect, test } from 'bun:test'
import { settleDelay } from './screenSettle'

const cases: { now: number; since: number; ms: number; pad: number; want: number; why: string }[] = [
  { now: 1000, since: Number.NEGATIVE_INFINITY, ms: 380, pad: 120, want: 0, why: 'no screen change yet: heavy work at boot must not wait for a transition that never ran' },
  { now: 1000, since: 1000, ms: 380, pad: 120, want: 500, why: 'right after a switch the whole wave plus margin is still ahead' },
  { now: 1300, since: 1000, ms: 380, pad: 120, want: 200, why: 'mid-wave only the remainder is waited, not a fresh full delay' },
  { now: 1600, since: 1000, ms: 380, pad: 120, want: 0, why: 'after the wave the work starts at once' },
  { now: 1000, since: 1000, ms: 0, pad: 120, want: 120, why: 'transitions switched off still leave the mount frame alone' },
  { now: 1000, since: 1000, ms: -50, pad: 120, want: 120, why: 'a corrupt negative preference must not eat into the safety margin' },
]

test.each(cases)('settleDelay $why', ({ now, since, ms, pad, want }) => {
  expect(settleDelay(now, since, ms, pad), 'heavy 3D work would land on the transition frames and stall the wave').toBe(want)
})
