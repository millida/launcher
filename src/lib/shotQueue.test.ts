import { expect, test } from 'bun:test'
import { pickJob } from './shotQueue'

test('every first frame goes before any loop, then the most visible, then the first asked', () => {
  const cases: [{ at: number; rank: number; tier?: number }[], number, string][] = [
    [[{ at: 0, rank: 2 }, { at: 1, rank: 0 }], 1, 'the visible tile goes first'],
    [[{ at: 0, rank: 0 }, { at: 1, rank: 0 }], 0, 'equally visible: the one that asked first'],
    [[{ at: 0, rank: 0, tier: 1 }, { at: 1, rank: 2, tier: 0 }], 1, 'a far first frame beats a visible loop'],
    [[{ at: 0, rank: 1, tier: 1 }, { at: 1, rank: 0, tier: 1 }], 1, 'among loops the visible one goes first'],
    [[{ at: 3, rank: 0 }, { at: 1, rank: 0, tier: 0 }], 1, 'no tier counts as a first frame'],
  ]
  for (const [list, want, why] of cases) expect(pickJob(list), why).toBe(want)
})
