import { expect, test } from 'bun:test'
import { PROMO_ORDER, promoAt, promoSlides, promoStart } from './promo'

test('slides keep the owner order and drop packs missing from the catalogue', () => {
  expect(promoSlides({ arcania: true, prisonrpg: true })).toEqual(PROMO_ORDER)
  expect(promoSlides({ arcania: false, prisonrpg: true })).toEqual(['discord', 'telegram', 'anarchy', 'prisonrpg', 'smp'])
  expect(promoSlides({ arcania: false, prisonrpg: false })).toEqual(['discord', 'telegram', 'anarchy', 'smp'])
})

test('rotation walks every slide and wraps', () => {
  const s = promoSlides({ arcania: true, prisonrpg: false })
  const seen = Array.from({ length: s.length * 2 }, (_, i) => promoAt(s, 3, i))
  expect(new Set(seen).size).toBe(s.length)
  expect(promoAt(s, 3, s.length)).toBe(promoAt(s, 3, 0))
  expect(promoAt([], 0, 5)).toBeNull()
  expect(promoAt(s, 0, Number.NaN)).toBe(s[0]!)
})

test('start is spread by day and player, never out of range', () => {
  for (let day = 0; day < 20; day++) for (const salt of [0, 1, 7, 123456789]) {
    const i = promoStart(5, day, salt)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(5)
  }
  expect(promoStart(5, 1, 0)).not.toBe(promoStart(5, 2, 0))
  expect(promoStart(0, 1, 1)).toBe(0)
})
