import { describe, expect, test } from 'bun:test'
import { DEFAULT_PROMO, readPromo, type ListedServer } from './promo'

describe('readPromo', () => {
  const cases: Array<[string, unknown, Partial<ReturnType<typeof readPromo>>]> = [
    ['no answer keeps what the release shipped', null, DEFAULT_PROMO],
    ['an empty answer keeps every placement', {}, DEFAULT_PROMO],
    ['the anarchy hidden everywhere', { lobby: null, modesLead: null, forYou: ['hosting', 'ONEBLOCK'] }, { lobby: null, modesLead: null, forYou: ['hosting', 'ONEBLOCK'] }],
    ['the head order follows the API', { forYou: ['ONEBLOCK', 'hosting', 'MCRU_ANARCHY'] }, { forYou: ['ONEBLOCK', 'hosting', 'MCRU_ANARCHY'] }],
    ['an unknown card is dropped, the rest stay', { forYou: ['hosting', 'ARCANIA'] }, { forYou: ['hosting'] }],
    ['a bad slot value falls back instead of hiding the card', { lobby: 'ONEBLOCK' }, { lobby: DEFAULT_PROMO.lobby }],
    ['a new address and version reach the join', { anarchy: { addr: 'Play.MCRU.me', version: '1.21.11' } }, { anarchy: { addr: 'play.mcru.me', version: '1.21.11' } }],
    ['a node IP never reaches the player', { anarchy: { addr: '149.50.110.80:25565' } }, { anarchy: {} }],
    ['a broken version keeps the built-in one', { anarchy: { version: 'latest', name: 'Анархия' } }, { anarchy: { name: 'Анархия' } }],
  ]
  for (const [why, raw, want] of cases)
    test(why, () => {
      expect(readPromo(raw), why).toEqual({ ...DEFAULT_PROMO, ...want })
    })
})

describe('readPromo serverList', () => {
  const cases: Array<[string, unknown, ListedServer[]]> = [
    ['no list keeps the lever off', {}, []],
    ['a listed server reaches the builds', { serverList: [{ name: 'Анархия MCRU', addr: 'MCRU.me', minVersion: '1.21' }] }, [{ name: 'Анархия MCRU', addr: 'mcru.me', minVersion: '1.21' }]],
    ['a node IP never lands in a player list', { serverList: [{ name: 'X', addr: '149.50.110.80' }] }, []],
    ['a broken minimum is dropped, the server stays', { serverList: [{ name: 'A', addr: 'mcru.me', minVersion: 'new' }] }, [{ name: 'A', addr: 'mcru.me' }]],
  ]
  for (const [why, raw, want] of cases)
    test(why, () => {
      expect(readPromo(raw).serverList, why).toEqual(want)
    })
})
