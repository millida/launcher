import { describe, expect, test } from 'bun:test'
import type { ShopCard, ShopDay } from '../../lib/rubies'
import { nextUnaffordable, nowAffordable, recommendPack, shortfallItem, type PickOption } from './packNeed'

const opt = (code: string, rubies: number, kopecks: number): PickOption => ({ code, title: code, rubies, kopecks, art: '', pack: { code, title: code, rubies, kopecks } })

const card = (code: string, price: number, owned = false): ShopCard => ({
  item: { code, name: code, slot: 'HAT', rarity: 'RARE', preview: null },
  price,
  basePrice: price,
  discountPct: 0,
  owned,
  leavesAt: '',
})

const day = (balance: number, items: ShopCard[], wishlist: string[], deal: ShopCard | null = null): ShopDay =>
  ({
    balance,
    shards: 0,
    plus: false,
    day: { featured: null, deal, items, forYou: [], refreshAt: '2026-11-19' },
    bundle: null,
    nightMarket: null,
    xray: null,
    packs: [],
    wishlist,
  }) as unknown as ShopDay

const OPTS = [opt('handful', 650, 9900), opt('bag', 1375, 19900), opt('vault', 30000, 300000)]

describe('recommendPack — вход → рекомендация', () => {
  const cases: [string, number, number, string][] = [
    ['самый дешёвый из хватающих', 0, 1000, 'bag'],
    ['точно граница — хватает ровно', 0, 1375, 'bag'],
    ['учёт баланса снижает цель', 1000, 1600, 'handful'],
    ['не хватает ни одного — самый крупный', 0, 999999, 'vault'],
  ]
  for (const [why, held, target, code] of cases) {
    test(why, () => expect(recommendPack(OPTS, held, target)?.code).toBe(code))
  }
})

describe('shortfallItem — что предложить при нехватке', () => {
  test('вещь из «Хочу» с самой маленькой нехваткой — первой', () => {
    const d = day(345, [card('cheap', 350), card('far', 900)], ['far', 'cheap'])
    expect(shortfallItem(d)?.card.item.code).toBe('cheap')
  })
  test('нет желаний — берётся сделка дня', () => {
    const d = day(100, [card('x', 500)], [], card('deal1', 400))
    expect(shortfallItem(d)?.card.item.code).toBe('deal1')
  })
  test('купленное и доступное по балансу не предлагается', () => {
    const d = day(500, [card('owned', 400, true), card('affordable', 450)], [])
    expect(shortfallItem(d)).toBeNull()
  })
})

describe('nextUnaffordable / nowAffordable', () => {
  test('следующая вещь дороже остатка', () => {
    const d = day(0, [card('a', 300), card('b', 800)], ['a', 'b'])
    expect(nextUnaffordable(d, 400, 'a')?.name).toBe('b')
  })
  test('баланс вырос и покрыл вещь из «Хочу»', () => {
    const d = day(500, [card('want', 450)], ['want'])
    expect(nowAffordable(d, 300)?.card.item.code).toBe('want')
  })
  test('рост баланса, но вещь была доступна и раньше — тишина', () => {
    const d = day(500, [card('want', 450)], ['want'])
    expect(nowAffordable(d, 460)).toBeNull()
  })
})
