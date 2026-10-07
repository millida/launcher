import { describe, expect, test } from 'bun:test'
import { demoSets } from './demoSets'
import type { DemoCatalogItem } from './demoShop'
import { plusOf, tierPct } from '../../lib/rubies'

const item = (id: string, price: number): DemoCatalogItem => ({ id, name: id, slot: 'HAT', access: 'PURCHASE', priceRubies: price, preview: 'x.png' })
const catalog = ['FIRE_HAIR_REMASTER', 'FIRE_EYES_REMASTER', 'FIRE_ARMOR_REMASTER', 'FIRE_FEET_REMASTER'].map((id) => item(id, 500))

const make = (balance: number) => {
  const wallet = { balance }
  return { wallet, api: demoSets({ catalog: async () => catalog, wallet, ownedBases: async () => [] }) }
}

describe('магазин v2: подписка и ящики', () => {
  test('plusOf и tierPct: −10% до десятка, у подписчика 10 и 15', () => {
    expect(plusOf(700)).toBe(630)
    expect(plusOf(1130)).toBe(1020)
    expect(tierPct(null)).toBe(0)
    expect(tierPct('PLUS')).toBe(10)
    expect(tierPct('DIAMOND')).toBe(15)
  })

  test('девять ящиков (восемь за рубины и «Осколочный»), один — ящик дня, у остальных нет скидки дня; лента выпадений есть', async () => {
    const big = Array.from({ length: 40 }, (_, i) => ({ ...item('ITEM_' + i, 500), slot: ['WINGS', 'PET', 'EMOTE', 'HAT'][i % 4]! }))
    const api = demoSets({ catalog: async () => [...catalog, ...big], wallet: { balance: 9000 }, ownedBases: async () => [] })
    const r = await api.cases()
    expect(r.cases.map((c) => c.id)).toEqual(['flame', 'dark', 'future', 'cozy', 'wings', 'pets', 'emotes', 'mythic', 'shards'])
    expect(r.cases.filter((c) => c.ofDay).length).toBe(1)
    for (const c of r.cases) {
      expect(c.color).toMatch(/^[0-9A-F]{6}$/)
      expect(c.price).toBeLessThanOrEqual(c.basePrice)
      // PLUS и ящик дня не складываются: у ящика дня цена с PLUS не ниже его цены.
      if (c.currency !== 'shards') expect(c.plusPrice!).toBeLessThanOrEqual(c.price)
    }
    const day = r.cases.find((c) => c.ofDay)!
    expect(day.price).toBeLessThan(day.basePrice)
    const mythic = r.cases.find((c) => c.id === 'mythic')!
    expect(mythic.pityFrom).toBe('LEGENDARY')
    expect(r.ofDayPct).toBe(15)
    expect(Array.isArray(r.drops)).toBe(true)
  })
})

describe('demoSets', () => {
  test('набор: цена со скидкой и защита expect', async () => {
    const { wallet, api } = make(5000)
    const { sets } = await api.sets()
    const set = sets.find((s) => s.id === 'fire_lord')!
    const way = set.colorways[0]!
    expect(way.items.length).toBe(4)
    expect(way.price).toBeLessThan(way.fullPrice)
    await expect(api.buy({ setId: 'fire_lord', colorway: '', expect: way.price + 10 })).rejects.toThrow('изменилась')
    expect(wallet.balance).toBe(5000)
    const res = await api.buy({ setId: 'fire_lord', colorway: '', expect: way.price })
    expect(res.balance).toBe(5000 - way.price)
    const after = (await api.sets()).sets.find((s) => s.id === 'fire_lord')!.colorways[0]!
    expect(after.have).toBe(4)
    expect(after.price).toBe(0)
  })

  test('ящик: шансы в сумме 100%, открытие выдаёт вещь или приз и списывает цену', async () => {
    const { wallet, api } = make(5000)
    const c = (await api.cases()).cases.find((x) => x.id === 'flame')!
    expect(c.odds.reduce((n, o) => n + o.weight, 0)).toBeGreaterThan(990)
    const got = await api.open({ caseId: 'flame', requestId: 'a'.repeat(12) })
    const back = (got.rewards ?? []).reduce((n, r) => n + (r.kind === 'rubies' ? r.amount ?? 0 : 0), 0)
    expect(wallet.balance).toBe(5000 - c.price + back)
    expect((got.rewards ?? []).length).toBeGreaterThanOrEqual(2)
    // Вещь или утешительный приз (служба c8151757a): у приза — сумма.
    if (got.kind === 'item') expect(got.item!.code.length).toBeGreaterThan(0)
    else expect(got.amount).toBeGreaterThan(0)
    expect(got.pityLeft).toBeGreaterThan(0)
  })
})

describe('утешительные призы ящика', () => {
  test('строка призов: вид — от и до', async () => {
    const { prizeRanges } = await import('./casePrizes')
    expect(
      prizeRanges([
        { kind: 'shards', min: 20, max: 40 },
        { kind: 'shards', min: 40, max: 80 },
        { kind: 'rubies', min: 30, max: 30 },
      ]),
    ).toEqual([
      { kind: 'shards', min: 20, max: 80 },
      { kind: 'rubies', min: 30, max: 30 },
    ])
  })
})

describe('ящики v2: гарантия, ×10, бесплатный (служба 90dde4154)', () => {
  const many = () => {
    const big = Array.from({ length: 60 }, (_, i) => ({ ...item('ITEM_' + i, [120, 300, 700, 1500, 3000][i % 5]!), slot: ['WINGS', 'PET', 'EMOTE', 'HAT'][i % 4]! }))
    const wallet = { balance: 50000 }
    return { wallet, api: demoSets({ catalog: async () => [...catalog, ...big], wallet, ownedBases: async () => [] }) }
  }

  test('у карточки гарантия, ×10 за 9 цен и бесплатный только у дешёвых за рубины', async () => {
    const { api } = many()
    const r = await api.cases()
    const by = (id: string) => r.cases.find((c) => c.id === id)!
    expect(by('dark').guarantee).toEqual({ minRarity: 'RARE', label: 'Редкая+ в каждом ящике' })
    expect(by('mythic').guarantee?.minRarity).toBe('EPIC')
    expect(by('flame').multi).toEqual({ count: 10, price: 6210, basePrice: 6900, floor: 'EPIC' })
    expect(by('cozy').multi).toBeNull()
    expect(by('shards').multi).toBeNull()
    expect(by('flame').freeAvailable).toBe(true)
    expect(by('dark').freeAvailable).toBe(false)
    expect(by('shards').freeAvailable).toBe(false)
  })

  test('×10: десять ящиков одним списанием, best — лучшая редкость', async () => {
    const { wallet, api } = many()
    const got = await api.open({ caseId: 'mythic', requestId: 'x10', count: 10 })
    expect(got.count).toBe(10)
    expect(got.opens!.length).toBe(10)
    expect(got.price).toBe(2490 * 9)
    const ranks = got.opens!.map((o) => o.rarity).filter(Boolean)
    expect(got.best).toBeDefined()
    expect(ranks).toContain(got.best!)
    expect(wallet.balance).toBeLessThan(50000)
  })

  test('бесплатный: без списания, второй раз — отказ', async () => {
    const { wallet, api } = many()
    const got = await api.open({ caseId: 'flame', requestId: 'f1', free: true })
    expect(got.price).toBe(0)
    expect(got.kind).toBe('item')
    const back = (got.rewards ?? []).reduce((n, r) => n + (r.kind === 'rubies' ? r.amount ?? 0 : 0), 0)
    expect(wallet.balance).toBe(50000 + back)
    await expect(api.open({ caseId: 'flame', requestId: 'f2', free: true })).rejects.toThrow('уже открыт')
    expect((await api.cases()).cases.every((c) => !c.freeAvailable)).toBe(true)
  })
})
