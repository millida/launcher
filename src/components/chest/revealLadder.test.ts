import { describe, expect, test } from 'bun:test'
import { dealOrder, finalRarity, ladderAt, revealLadder } from './revealLadder'
import type { CaseOpenView } from '../../lib/rubies'

const open = (kind: CaseOpenView['kind'], rarity?: CaseOpenView['rarity']): CaseOpenView => ({ kind, rarity, rewards: [], top: false })

describe('рост редкости сундука', () => {
  test('лестница от пола до итога, ниже пола — только пол', () => {
    expect(revealLadder('RARE', 'LEGENDARY')).toEqual(['RARE', 'EPIC', 'LEGENDARY'])
    expect(revealLadder('RARE', 'RARE')).toEqual(['RARE'])
    expect(revealLadder('EPIC', 'COMMON')).toEqual(['EPIC'])
    expect(revealLadder('COMMON')).toEqual(['COMMON'])
  })
  test('подъёмы на последних ударах, последний удар — итог, выше итога никогда', () => {
    const l = revealLadder('RARE', 'EPIC')
    expect([1, 2, 3].map((h) => ladderAt(l, h, 3))).toEqual([0, 0, 1])
    const long = revealLadder('COMMON', 'MYTHIC')
    expect([1, 2, 3].map((h) => ladderAt(long, h, 3))).toEqual([3, 4, 5])
    expect(ladderAt(long, 0, 3)).toBe(0)
    for (let h = 1; h <= 4; h++) expect(ladderAt(l, h, 3)).toBeLessThanOrEqual(1)
  })
  test('итог — главная вещь; дешёвая вещь промаха не растит сундук', () => {
    expect(finalRarity([open('cheap', 'UNCOMMON')])).toBeUndefined()
    expect(finalRarity([open('item', 'RARE'), open('item', 'LEGENDARY'), open('shards')])).toBe('LEGENDARY')
  })
  test('×10: лучшая карта открывается последней', () => {
    const order = dealOrder([open('item', 'RARE'), open('item', 'MYTHIC'), open('cheap', 'COMMON'), open('item', 'EPIC')])
    expect(order).toEqual([0, 2, 3, 1])
  })
})
