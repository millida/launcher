import { beforeEach, describe, expect, test } from 'bun:test'
import { HINT_FRESH_MS, _resetLookHint, forgetWorn, lookHint, noteTexture, noteWorn } from './lookHint'

const skin = { skinUrl: 'https://cdn/s.png', capeUrl: null, model: 'slim' }

describe('lookHint', () => {
  beforeEach(() => _resetLookHint())

  test('what the launcher just put on comes back for the same account', () => {
    noteWorn([{ id: 'HAT', slot: 'HEAD' }], 'a1', 1000)
    expect(lookHint('a1', 1000 + HINT_FRESH_MS)?.worn).toEqual([{ id: 'HAT', slot: 'HEAD' }])
  })

  test('another account and a stale hint read the service again', () => {
    noteWorn([{ id: 'HAT', slot: 'HEAD' }], 'a1', 1000)
    expect(lookHint('a2', 1000)).toBeNull()
    expect(lookHint('a1', 1001 + HINT_FRESH_MS)).toBeNull()
  })

  test('skin and items applied one after the other make one hint', () => {
    noteTexture(skin, 'a1', 1000)
    noteWorn([{ id: 'HAT', slot: 'HEAD' }], 'a1', 2000)
    expect(lookHint('a1', 2000)).toEqual({ who: 'a1', at: 2000, texture: skin, worn: [{ id: 'HAT', slot: 'HEAD' }] })
  })

  test('a stale or foreign hint does not lend its parts to a new one', () => {
    noteWorn([{ id: 'HAT', slot: 'HEAD' }], 'a1', 1000)
    noteTexture(skin, 'a1', 2000 + HINT_FRESH_MS)
    expect(lookHint('a1', 2000 + HINT_FRESH_MS)?.worn).toBeUndefined()
    noteTexture(skin, 'a2', 3000 + HINT_FRESH_MS)
    expect(lookHint('a2', 3000 + HINT_FRESH_MS)).toEqual({ who: 'a2', at: 3000 + HINT_FRESH_MS, texture: skin })
  })

  test('a partial apply drops the items it no longer knows, the skin stays', () => {
    noteTexture(skin, 'a1', 1000)
    noteWorn([{ id: 'HAT', slot: 'HEAD' }], 'a1', 1000)
    forgetWorn('a1', 1500)
    expect(lookHint('a1', 1500)).toEqual({ who: 'a1', at: 1000, texture: skin })
    noteWorn([{ id: 'HAT', slot: 'HEAD' }], 'a2', 2000)
    forgetWorn('a2', 2000)
    expect(lookHint('a2', 2000)).toBeNull()
  })
})
