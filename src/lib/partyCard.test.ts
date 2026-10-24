import { describe, expect, test } from 'bun:test'
import { encodePartyCard, parsePartyCard, partyCardExpired, PARTY_PREFIX } from './partyCard'

describe('party card in chat', () => {
  test('a card survives the trip through the chat', () => {
    const card = { code: 'ABCD2345', size: 2, capacity: 3, expiresAt: 1_900_000_000_000 }
    expect(parsePartyCard(encodePartyCard(card))).toEqual(card)
  })

  const bad: Array<[string, string]> = [
    ['plain text is not a card', 'привет'],
    ['broken JSON from an old or foreign client', PARTY_PREFIX + '{code:'],
    ['a code with letters the alphabet never uses would only fail on the server', PARTY_PREFIX + '{"code":"OOOO1111"}'],
    ['a short code', PARTY_PREFIX + '{"code":"ABC"}'],
  ]
  for (const [why, text] of bad) test(why, () => expect(parsePartyCard(text)).toBeNull())

  test('numbers from another player are clamped, not trusted', () => {
    const card = parsePartyCard(PARTY_PREFIX + '{"code":"ABCD2345","size":-5,"capacity":1e9,"exp":"x"}')
    expect(card).toEqual({ code: 'ABCD2345', size: 0, capacity: 99, expiresAt: 0 })
  })

  test('an expired code says so before the player presses join', () => {
    expect(partyCardExpired({ code: 'ABCD2345', size: 1, capacity: 3, expiresAt: 1000 }, 2000)).toBe(true)
    expect(partyCardExpired({ code: 'ABCD2345', size: 1, capacity: 3, expiresAt: 0 }, 2000)).toBe(false)
  })
})
