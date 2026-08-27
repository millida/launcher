import { describe, expect, it } from 'bun:test'
import { CARD_MAX_MS, CARD_TTL_MS, cardDeadline, freshCards, holdCards } from './overlayCards'

const card = (ts: number, expires = ts + CARD_TTL_MS) => ({ ts, expires, uid: 'u' + ts })

// Вход → вердикт. Карточка оверлея живёт поверх всех окон, поэтому «висит
// вечно» — это не косметика: закрыть её нечем, кроме трея.
describe('срок жизни карточки оверлея', () => {
  it('наведение продлевает карточку ровно на удержанное время', () => {
    const [held] = holdCards([card(1_000)], 4_000)
    expect(held.expires).toBe(1_000 + CARD_TTL_MS + 4_000)
  })

  it('удержание не поднимает срок выше потолка: курсор, забытый в углу, не делает карточку вечной', () => {
    const [held] = holdCards([card(1_000)], 10 * CARD_MAX_MS)
    expect(held.expires).toBe(1_000 + CARD_MAX_MS)
  })

  it('нулевое удержание не трогает список: лишняя копия сбивала бы hit-области', () => {
    const list = [card(1_000)]
    expect(holdCards(list, 0)).toBe(list)
  })

  it('потолок действует и на срок, выставленный в обход holdCards', () => {
    expect(cardDeadline({ ts: 1_000, expires: 1_000 + 10 * CARD_MAX_MS })).toBe(1_000 + CARD_MAX_MS)
  })

  const now = 100_000
  const cases: Array<[string, Parameters<typeof freshCards>[0], number[]]> = [
    ['живая карточка показывается', [card(now - 1_000)], [now - 1_000]],
    ['истёкшая уходит', [card(now - CARD_TTL_MS - 1)], []],
    [
      'застрявшая на паузе уходит по потолку',
      [{ ts: now - CARD_MAX_MS - 1, expires: now + 10 * CARD_MAX_MS }],
      [],
    ],
  ]

  for (const [why, list, want] of cases) {
    it(why, () => {
      expect(freshCards(list, now, 3).map((c) => c.ts)).toEqual(want)
    })
  }

  it('показываются только последние три: пачка друзей не застилает экран', () => {
    const list = [card(1), card(2), card(3), card(4)]
    expect(freshCards(list, 5, 3).map((c) => c.ts)).toEqual([2, 3, 4])
  })
})
