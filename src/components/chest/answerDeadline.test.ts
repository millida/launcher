import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ANSWER_TIMEOUT_MS, caseOpenKeys, hitView, skipAction, type HitView } from './answerDeadline'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('opening screen while the server answer is pending', () => {
  const cases: Array<{ hits: number; need: number; answered: boolean; late: boolean; want: HitView; why: string }> = [
    { hits: 1, need: 3, answered: false, late: false, want: 'tap', why: 'hits left: the player keeps tapping, the answer is not needed yet' },
    { hits: 1, need: 3, answered: false, late: true, want: 'tap', why: 'a slow answer must not interrupt the hits the player is still making' },
    { hits: 3, need: 3, answered: false, late: false, want: 'wait', why: 'hits done, answer in flight: running dots, no dead «Жми!»' },
    { hits: 3, need: 3, answered: false, late: true, want: 'stalled', why: 'past the deadline the dots used to spin for a minute; the player must get retry and close' },
    { hits: 3, need: 3, answered: true, late: true, want: 'wait', why: 'a late answer that finally arrived goes on to the burst, not to the error' },
    { hits: 4, need: 4, answered: true, late: false, want: 'wait', why: 'answered and done: the burst is about to start' },
  ]
  for (const c of cases)
    test(`${c.hits}/${c.need} answered=${c.answered} late=${c.late}`, () => {
      expect(hitView(c.hits, c.need, c.answered, c.late), c.why).toBe(c.want)
    })

  test('the deadline stays within the agreed 12-15 seconds', () => {
    expect(ANSWER_TIMEOUT_MS, 'shorter cuts off honest slow networks, longer brings back the minute-long hang').toBeGreaterThanOrEqual(12_000)
    expect(ANSWER_TIMEOUT_MS, 'the core read timeout is 60 s; the screen must give up far earlier').toBeLessThanOrEqual(15_000)
  })
})

describe('«Пропустить» always leads somewhere', () => {
  const cases: Array<{ answered: boolean; want: ReturnType<typeof skipAction>; why: string }> = [
    { answered: true, want: 'summary', why: 'with the rewards known skip jumps to the summary' },
    { answered: false, want: 'close', why: 'without an answer skip closes; before it was disabled and the window could not be left' },
  ]
  for (const c of cases)
    test(`answered=${c.answered}`, () => {
      expect(skipAction(c.answered), c.why).toBe(c.want)
    })

  test('the skip button is never disabled and the stall offers retry and close', () => {
    const reveal = source('./CaseReveal.tsx')
    const skipButton = reveal.slice(reveal.indexOf('data-track="case_skip"'), reveal.indexOf('data-track="case_skip"') + 200)
    expect(skipButton, 'a disabled skip is exactly what kept the tester on the spinning dots').not.toContain('disabled')
    expect(reveal, 'the stalled view must offer a retry').toContain('data-track="case_retry"')
    expect(reveal, 'the stalled view must offer a way out').toContain('data-track="case_stall_close"')
  })
})

describe('case purchase key survives retries', () => {
  test('one key per opening, a new one for the next opening or «Ещё раз»', () => {
    let n = 0
    const keys = caseOpenKeys(() => 'k' + ++n)
    const first = {}
    const second = {}
    const rows: Array<{ opening: object; run: number; want: string; why: string }> = [
      { opening: first, run: 0, want: 'k1', why: 'the first request takes a fresh key' },
      { opening: first, run: 0, want: 'k1', why: 'a retry of the same opening must reuse the key, or the server charges twice' },
      { opening: first, run: 1, want: 'k2', why: '«Ещё раз» is a new purchase and needs a new key' },
      { opening: second, run: 1, want: 'k3', why: 'another case with the same run number must not replay the previous purchase' },
    ]
    for (const r of rows) expect(keys.at(r.opening, r.run), r.why).toBe(r.want)
  })

  test('the shop passes the stable key, not a new id per request', () => {
    const shop = source('../shop/Cases.tsx')
    expect(shop, 'newRequestId() inside request would charge again on every retry').toContain('openKey.current.at(view, run)')
  })
})
