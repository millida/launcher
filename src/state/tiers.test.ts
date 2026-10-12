import { describe, expect, test } from 'bun:test'
import { bestTier, divisionOf, nextTier, playerTiers, tierRank } from './tiers'
import { serverNeedsMillidaAuth } from '../lib/ownServer'

describe('tiers', () => {
  test('HT1 is the top, LT5 the bottom, junk is no tier', () => {
    expect(tierRank('HT1')).toBe(0)
    expect(tierRank('LT1')).toBe(2)
    expect(tierRank('HT2')).toBe(3)
    expect(tierRank('lt5')).toBe(14)
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
    // Тот же сервер под адресом сайта (millida.net/tiers).
    expect(serverNeedsMillidaAuth('smp.millida.net')).toBe(true)
    expect(serverNeedsMillidaAuth('mc.hypixel.net')).toBe(false)
    expect(serverNeedsMillidaAuth('')).toBe(false)
    expect(serverNeedsMillidaAuth(null)).toBe(false)
  })
})


describe('лестница тиров с MT (как у MCPVP)', () => {
  test('HT выше MT, MT выше LT, ступень 1 выше ступени 2', () => {
    expect(tierRank('HT1')).toBe(0)
    expect(tierRank('MT1')).toBe(1)
    expect(tierRank('LT1')).toBe(2)
    expect(tierRank('HT2')).toBe(3)
    expect(tierRank('LT5')).toBe(14)
  })
  test('MT — настоящий тир: раньше он считался «без тира» и пропадал из лаунчера', () => {
    expect(playerTiers({ uuid: '', name: 'a', points: 0, title: '', modes: { sword: { tier: 'MT4', peak: 'MT4', verified: false, elo: 0, games: 0, wins: 0, losses: 0 } } })).toEqual({ sword: 'MT4' })
    expect(bestTier({ sword: 'LT3', pot: 'MT3' })).toEqual({ mode: 'pot', tier: 'MT3' })
  })
  test('NONE и ??? — не тир', () => {
    expect(tierRank('NONE')).toBeNull()
    expect(tierRank('???')).toBeNull()
  })
})

describe('следующий тир и дивизион сезона', () => {
  const rules = [
    { tier: 'HT4', points: 10, minElo: 1150, minGames: 5 },
    { tier: 'MT4', points: 8, minElo: 1100, minGames: 5 },
    { tier: 'LT4', points: 6, minElo: 1050, minGames: 5 },
  ]
  test('до следующего тира — по ELO', () => {
    expect(nextTier(rules, 'LT4', 1070)).toEqual({ tier: 'MT4', need: 30, from: 1050 })
  })
  test('выше правил — некуда', () => {
    expect(nextTier(rules, 'HT4', 1200)).toBeNull()
  })
  test('дивизион по очкам сезона', () => {
    const season = { title: 'Сезон 1', divisions: [{ min: 1000, color: '#ccc', name: 'Серебро' }, { min: 0, color: '#c98', name: 'Бронза' }] }
    expect(divisionOf(season, 150)?.name).toBe('Бронза')
    expect(divisionOf(season, 150)?.next?.name).toBe('Серебро')
    expect(divisionOf(season, 1200)?.name).toBe('Серебро')
  })
})
