import { describe, expect, test } from 'bun:test'
import { shopCards } from './wish'
import type { ShopDay } from '../../lib/rubies'

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
