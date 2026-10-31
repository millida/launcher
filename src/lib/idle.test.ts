import { expect, test } from 'bun:test'
import { keepWaiting } from './idle'

const cases: Array<[string, boolean, number, number, number, boolean]> = [
  ['a frame with time to spare is taken at once', false, 12, 100, 5000, false],
  ['a busy frame before the deadline waits for a freer one', false, 4.6, 1000, 5000, true],
  ['30.10: a 144 Hz frame never has 8 ms free, past the deadline it loads anyway', false, 4.6, 6000, 5000, false],
  ['the browser ran out of patience: run now', true, 0, 100, 5000, false],
]

for (const [why, didTimeout, remaining, waited, maxWait, wait] of cases)
  test(why, () => expect(keepWaiting(didTimeout, remaining, waited, maxWait), why).toBe(wait))
