import { describe, expect, test } from 'bun:test'
import { kopecksFor, shopCards, topUpRubies } from './wish'
import type { ShopDay } from '../../lib/rubies'

describe('topUpRubies', () => {
  test('кратно 7 — служба кладёт копейки в целое поле', () => {
    for (const n of [1, 6, 7, 8, 10, 13, 99, 1000]) {
      const r = topUpRubies(n)
      expect(r % 7).toBe(0)
      expect(r).toBeGreaterThanOrEqual(n)
      expect(r - n).toBeLessThan(7)
      expect(Number.isInteger((r * 100) / 7)).toBe(true)
      expect(kopecksFor(r)).toBe((r / 7) * 100)
    }
  })
})

describe('shopCards', () => {
  test('featured/deal = null (пустой пул витрины) не роняет магазин', () => {
    const card = { item: { code: 'A' } } as never
    const day = {
      day: { featured: null, deal: null, items: [card], forYou: [], refreshAt: '' },
      nightMarket: null,
    } as unknown as ShopDay
    expect(shopCards(day).map(([, s]) => s)).toEqual(['day'])
  })
})
