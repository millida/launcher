import { describe, expect, test } from 'bun:test'
import { demoSets } from './demoSets'
import type { DemoCatalogItem } from './demoShop'

const item = (id: string, price: number): DemoCatalogItem => ({ id, name: id, slot: 'HAT', access: 'PURCHASE', priceRubies: price, preview: 'x.png' })
const catalog = ['FIRE_HAIR_REMASTER', 'FIRE_EYES_REMASTER', 'FIRE_ARMOR_REMASTER', 'FIRE_FEET_REMASTER'].map((id) => item(id, 500))

const make = (balance: number) => {
  const wallet = { balance }
  return { wallet, api: demoSets({ catalog: async () => catalog, wallet, ownedBases: async () => [] }) }
}

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

  test('ящик: шансы в сумме 100%, открытие выдаёт вещь и списывает цену', async () => {
    const { wallet, api } = make(5000)
    const c = (await api.cases()).cases.find((x) => x.id === 'flame')!
    expect(c.odds.reduce((n, o) => n + o.weight, 0)).toBeGreaterThan(990)
    const got = await api.open({ caseId: 'flame', requestId: 'a'.repeat(12) })
    expect(wallet.balance).toBe(5000 - c.price)
    expect(got.item.code.length).toBeGreaterThan(0)
    expect(got.pityLeft).toBeGreaterThan(0)
  })
})
