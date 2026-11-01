import { afterEach, describe, expect, test } from 'bun:test'
import { useI18n } from '../i18n'
import { marketPacks, sellsPaidPacks } from './paidPacks'
import { marketFor } from './api'

const before = useI18n.getState().locale
const packs = [
  { slug: 'arcania', accessRequired: true, partner: { slug: 'arcania-labs' } },
  { slug: 'local-paid', accessRequired: true, partner: { slug: 'some-studio' } },
  { slug: 'free-pack', accessRequired: false },
  { slug: 'legacy' },
]

afterEach(() => useI18n.setState({ locale: before }))

describe('paid packs are sold on the ruble market, worldwide partners everywhere', () => {
  const cases: { why: string; locale: string; sells: boolean; slugs: string[] }[] = [
    { why: 'the Russian launcher keeps paid packs, they are sold in rubles', locale: 'ru', sells: true, slugs: ['arcania', 'local-paid', 'free-pack', 'legacy'] },
    { why: 'a Ukrainian launcher reads Russian packs and pays in rubles, so it keeps every paid pack', locale: 'uk', sells: true, slugs: ['arcania', 'local-paid', 'free-pack', 'legacy'] },
    { why: 'an English launcher keeps Arcania, a worldwide partner, and hides local paid packs', locale: 'en', sells: false, slugs: ['arcania', 'free-pack', 'legacy'] },
    { why: 'any other interface language is the international market too', locale: 'de', sells: false, slugs: ['arcania', 'free-pack', 'legacy'] },
  ]
  for (const c of cases)
    test(c.why, () => {
      useI18n.setState({ locale: c.locale as never })
      expect(sellsPaidPacks(), 'market verdict for ' + c.locale).toBe(c.sells)
      expect(marketPacks(packs).map((p) => p.slug), 'packs listed for ' + c.locale).toEqual(c.slugs)
    })

  test('premium requests carry the market so the server narrows the shelf abroad to worldwide partners', () => {
    useI18n.setState({ locale: 'en' as never })
    expect(marketFor('/launcher/premium'), 'premium showcase asks as the international market').toBe('EN')
    expect(marketFor('/launcher/premium/arcania'), 'premium pack asks as the international market').toBe('EN')
    useI18n.setState({ locale: 'uk' as never })
    expect(marketFor('/launcher/premium'), 'a Ukrainian launcher gets the whole ruble shelf').toBeUndefined()
    expect(marketFor('/rating/servers'), 'the rating stays split as before: Ukrainian reads the international one').toBe('EN')
    useI18n.setState({ locale: 'ru' as never })
    expect(marketFor('/launcher/premium'), 'the Russian launcher sends no header, as before').toBeUndefined()
  })
})
