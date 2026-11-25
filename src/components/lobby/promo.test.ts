import { expect, test } from 'bun:test'
import { PROMO_ORDER, TELEGRAM_CHAT, TELEGRAM_CHAT_EN, promoAt, promoSlides, promoStart, telegramChat } from './promo'

test('Arcania opens the carousel and is the only pack in it', () => {
  expect(promoSlides({ arcania: true, invite: true })).toEqual(PROMO_ORDER)
  expect(promoSlides({ arcania: true, invite: true })[0]).toBe('arcania')
  for (const gone of ['anarchy', 'prisonrpg', 'abonent'] as const) expect(promoSlides({ arcania: true, invite: true, collection: true })).not.toContain(gone)
  expect(promoSlides({ arcania: false, invite: false })).toEqual(['discord', 'telegram', 'smp'])
})

test('the invite slide shows only once the referral terms came from the server', () => {
  expect(promoSlides({ arcania: true, invite: false }), 'without live terms the slide would promise days nobody confirmed').not.toContain('invite')
  expect(promoSlides({ arcania: false, invite: true }).slice(-1)[0], 'the friend offer closes the carousel').toBe('invite')
})

test('outside the Russian market Telegram leads to the English channel', () => {
  expect(telegramChat(false), 'an English player is sent to the English channel, not the Russian one').toBe(TELEGRAM_CHAT_EN)
  expect(telegramChat(true), 'the Russian market keeps the channel the shop reward checks').toBe(TELEGRAM_CHAT)
})

test('rotation walks every slide and wraps', () => {
  const s = promoSlides({ arcania: true, invite: true })
  const seen = Array.from({ length: s.length * 2 }, (_, i) => promoAt(s, 3, i))
  expect(new Set(seen).size).toBe(s.length)
  expect(promoAt(s, 3, s.length)).toBe(promoAt(s, 3, 0))
  expect(promoAt([], 0, 5)).toBeNull()
  expect(promoAt(s, 0, Number.NaN)).toBe(s[0]!)
})

test('start is spread by day and player, never out of range', () => {
  for (let day = 0; day < 20; day++) for (const salt of [0, 1, 7, 123456789]) {
    const i = promoStart(5, day, salt)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(5)
  }
  expect(promoStart(5, 1, 0)).not.toBe(promoStart(5, 2, 0))
  expect(promoStart(0, 1, 1)).toBe(0)
})

test('a running cosmetics collection opens the carousel', () => {
  expect(promoSlides({ arcania: true, invite: true, collection: true }).slice(0, 2), 'the timed collection is the freshest news, it leads').toEqual(['collection', 'arcania'])
  expect(promoSlides({ arcania: true, invite: true }), 'without a running collection the slide does not appear').not.toContain('collection')
})
