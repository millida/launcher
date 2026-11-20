import { describe, expect, test } from 'bun:test'
import { collectionMembers, readCollections } from './collectionData'
import type { CosmeticItem } from '../../lib/gameProfile'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const florida = { id: 'florida', title: 'Флорида', description: 'Аллигаторы', items: ['MILLIDA_GATOR_HOOD', 'MILLIDA_GATOR_PET'], to: '2026-12-31T20:59:59Z', order: 1 }

describe('collections answer', () => {
  const cases: Array<{ raw: unknown; want: string[]; why: string }> = [
    { raw: { collections: [florida] }, want: ['florida'], why: 'a live collection from the service is shown' },
    { raw: { collections: [{ ...florida, to: '2026-11-01T00:00:00Z' }] }, want: [], why: 'an ended collection is hidden even if the cache still sends it' },
    { raw: { collections: [{ ...florida, id: '' }, null, 5] }, want: [], why: 'malformed rows are dropped instead of breaking the shop' },
    { raw: { collections: [{ ...florida, id: 'b', order: 2 }, { ...florida, id: 'a', order: 0 }] }, want: ['a', 'b'], why: 'collections follow the order the team set' },
    { raw: null, want: [], why: 'an older service without the endpoint shows nothing' },
  ]
  for (const c of cases) test(c.why, () => expect(readCollections(c.raw, NOW).map((x) => x.id)).toEqual(c.want))

  test('a missing title falls back to the id and a missing date means no end', () => {
    const [only] = readCollections({ collections: [{ id: 'x', items: ['A', 3] }] }, NOW)
    expect(only).toEqual({ id: 'x', title: 'x', description: '', items: ['A'], to: null, order: 0 })
  })
})

describe('collection members', () => {
  const item = (id: string, baseId?: string): CosmeticItem => ({ id, name: id, slot: 'HAT', access: 'PURCHASE', priceRubies: 100, ...(baseId ? { baseId } : {}) })
  const [coll] = readCollections({ collections: [florida] }, NOW)

  test('items match by code, colourways count once under their base code', () => {
    const catalog = [item('MILLIDA_GATOR_HOOD~green', 'MILLIDA_GATOR_HOOD'), item('MILLIDA_GATOR_HOOD~gold', 'MILLIDA_GATOR_HOOD'), item('MILLIDA_GATOR_PET'), item('FIRE_SWORD')]
    expect(collectionMembers(coll!, catalog).map((c) => c.id)).toEqual(['MILLIDA_GATOR_HOOD~green', 'MILLIDA_GATOR_PET'])
  })
})
