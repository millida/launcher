import { describe, expect, test } from 'bun:test'
import { bestTier, tierRank } from './tiers'
import { serverNeedsMillidaAuth } from '../lib/ownServer'

describe('tiers', () => {
  test('HT1 is the top, LT5 the bottom, junk is no tier', () => {
    expect(tierRank('HT1')).toBe(0)
    expect(tierRank('LT1')).toBe(1)
    expect(tierRank('HT2')).toBe(2)
    expect(tierRank('lt5')).toBe(9)
    expect(tierRank('RHT2')).toBeNull()
    expect(tierRank('')).toBeNull()
    expect(tierRank(undefined)).toBeNull()
  })

  test('best tier wins across modes, ties go to the earlier mode', () => {
    expect(bestTier({ sword: 'LT3', axe: 'HT3', pot: 'HT5' })).toEqual({ mode: 'axe', tier: 'HT3' })
    expect(bestTier({ pot: 'HT4', sword: 'HT4' }, ['sword', 'pot'])).toEqual({ mode: 'sword', tier: 'HT4' })
    expect(bestTier({ sword: 'none' })).toBeNull()
    expect(bestTier({})).toBeNull()
  })

  test('only Millida SMP itself forces the Millida account', () => {
    expect(serverNeedsMillidaAuth('mpvp.millida.host')).toBe(true)
    expect(serverNeedsMillidaAuth('MPVP.millida.host:25565')).toBe(true)
    expect(serverNeedsMillidaAuth('mc.hypixel.net')).toBe(false)
    expect(serverNeedsMillidaAuth('')).toBe(false)
    expect(serverNeedsMillidaAuth(null)).toBe(false)
  })
})
