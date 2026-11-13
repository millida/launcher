import { describe, expect, test } from 'bun:test'
import { grantedCodes, missingGrantedCodes } from './rewardOwnership'
import type { ChestDrop } from '../../lib/rubies'

const item = (code: string, duplicate = false): ChestDrop => ({ kind: 'ITEM', rarity: 'RARE', item: { code, name: 'Hat', slot: 'HEAD', previewUrl: null }, duplicate, shards: 0, variant: { name: 'red', color: 'ff0000' } })

describe('chest grant reconciliation', () => {
  test('a whole item uses its variant code once', () => {
    expect(grantedCodes([item('HAT'), item('HAT~red')])).toEqual(['HAT~red', 'HAT~red'])
    expect(missingGrantedCodes([item('HAT')], ['HAT~red'])).toEqual([])
  })

  test('fragments and duplicates do not claim ownership', () => {
    const fragments: ChestDrop = { kind: 'FRAGMENTS', rarity: 'RARE', item: { code: 'HAT', name: 'Hat', slot: 'HEAD', previewUrl: null }, amount: 2, have: 2, need: 5, completed: false, shards: 0 }
    expect(grantedCodes([fragments, item('HAT', true)])).toEqual([])
    expect(missingGrantedCodes([item('HAT')], [])).toEqual(['HAT~red'])
  })

  test('a bare owned code covers the drop variant and back', () => {
    expect(missingGrantedCodes([item('HAT')], ['HAT'])).toEqual([])
    const plain: ChestDrop = { kind: 'ITEM', rarity: 'RARE', item: { code: 'CAP', name: 'Cap', slot: 'HEAD', previewUrl: null }, duplicate: false, shards: 0 }
    expect(missingGrantedCodes([plain], ['CAP~blue'])).toEqual([])
    expect(missingGrantedCodes([item('HAT')], ['HAT~blue', 'CAP'])).toEqual(['HAT~red'])
  })
})
