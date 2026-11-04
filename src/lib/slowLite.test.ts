import { describe, expect, test } from 'bun:test'
import { STUTTER_GRACE_MS } from './slowLite'
import { STUTTER_EPISODES, STUTTER_WINDOW_MS, isStutter, stutterWatch } from './stutter'

const burst = (from: number, n: number, ms: number) => Array.from({ length: n }, (_, i) => ({ start: from + i * 400, duration: ms }))

describe('isStutter: a fit of long frames, not one slow moment', () => {
  const cases: [{ start: number; duration: number }[], boolean, string][] = [
    [burst(0, 8, 200), true, '8 frames of 200 ms in 3 s: the interface froze'],
    [burst(0, 7, 400), false, 'too few frames: one heavy moment, not a slow PC'],
    [burst(0, 10, 60), false, 'many frames, but 600 ms in all: barely felt'],
    [[...burst(0, 4, 300), ...burst(STUTTER_WINDOW_MS + 5000, 4, 300)], false, 'two halves far apart are two moments, not a fit'],
  ]
  for (const [frames, want, why] of cases)
    test(why, () => expect(isStutter(frames, frames[frames.length - 1]!.start)).toBe(want))
})

describe('stutterWatch: light graphics after the third fit of a session', () => {
  const fit = (w: ReturnType<typeof stutterWatch>, at: number, calm = 0) => burst(at, 8, 200).map((f) => w.frame(f.start, f.duration, calm))

  test('the third fit switches once, never again', () => {
    const w = stutterWatch()
    const fired: boolean[] = []
    for (let k = 0; k < STUTTER_EPISODES + 1; k++) fired.push(fit(w, STUTTER_GRACE_MS + k * 60_000).some(Boolean))
    expect(fired).toEqual([false, false, true, false])
  })

  test('frames in the first seconds after start or a screen change do not count', () => {
    const w = stutterWatch()
    const calm = 100_000
    for (let k = 0; k < STUTTER_EPISODES; k++) expect(fit(w, calm + k * 1000, calm).some(Boolean)).toBe(false)
  })
})
