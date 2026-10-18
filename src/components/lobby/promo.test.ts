import { expect, test } from 'bun:test'
import { PROMO_ORDER, promoAt, promoSlides, promoStart } from './promo'

const RU = { partners: true, ruContent: true }

test('slides keep the owner order and drop packs missing from the catalogue', () => {
  expect(promoSlides({ arcania: true, prisonrpg: true, invite: true, ...RU })).toEqual(PROMO_ORDER)
  expect(promoSlides({ arcania: false, prisonrpg: true, invite: false, ...RU })).toEqual(['discord', 'telegram', 'anarchy', 'prisonrpg', 'smp'])
  expect(promoSlides({ arcania: false, prisonrpg: false, invite: false, ...RU })).toEqual(['discord', 'telegram', 'anarchy', 'smp'])
})

test('the invite slide shows only once the referral terms came from the server', () => {
  expect(promoSlides({ arcania: true, prisonrpg: true, invite: false, ...RU }), 'without live terms the slide would promise days nobody confirmed').not.toContain('invite')
  expect(promoSlides({ arcania: false, prisonrpg: false, invite: true, ...RU }).slice(-1)[0], 'the friend offer closes the carousel after the owner-ordered slides').toBe('invite')
})

test('outside the Russian market partner servers and the Russian Telegram channel drop out', () => {
  const intl = promoSlides({ arcania: true, prisonrpg: true, invite: true, partners: false, ruContent: false })
  expect(intl, 'MCRU anarchy and MetaLabs prison are Russian partner servers, an English player has nowhere to talk to them').not.toContain('anarchy')
  expect(intl, 'the prison slide is a partner server even when its pack is in the catalogue').not.toContain('prisonrpg')
  expect(intl, 'the Telegram channel posts in Russian only').not.toContain('telegram')
  expect(intl, 'Millida own slides stay on every market').toEqual(['discord', 'arcania', 'smp', 'invite'])
})

test('rotation walks every slide and wraps', () => {
  const s = promoSlides({ arcania: true, prisonrpg: false, invite: true, ...RU })
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
