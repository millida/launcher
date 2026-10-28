import { afterEach, describe, expect, test } from 'bun:test'
import { useI18n } from '../i18n'
import { marketPacks, sellsPaidPacks } from './paidPacks'
import { marketFor } from './api'
import { loadPremiumPack, loadShowcase } from './premium'

const before = useI18n.getState().locale
const packs = [
  { slug: 'arcania', accessRequired: true },
  { slug: 'free-pack', accessRequired: false },
  { slug: 'legacy' },
]

afterEach(() => useI18n.setState({ locale: before }))

describe('paid packs exist only on the Russian market', () => {
  const cases: { why: string; locale: string; sells: boolean; slugs: string[] }[] = [
    { why: 'the Russian launcher keeps paid packs, they are sold in rubles', locale: 'ru', sells: true, slugs: ['arcania', 'free-pack', 'legacy'] },
    { why: 'an English launcher must not show a pack it cannot sell', locale: 'en', sells: false, slugs: ['free-pack', 'legacy'] },
    { why: 'any other interface language is the international market too', locale: 'de', sells: false, slugs: ['free-pack', 'legacy'] },
  ]
  for (const c of cases)
    test(c.why, () => {
      useI18n.setState({ locale: c.locale as never })
      expect(sellsPaidPacks(), 'market verdict for ' + c.locale).toBe(c.sells)
      expect(marketPacks(packs).map((p) => p.slug), 'packs listed for ' + c.locale).toEqual(c.slugs)
    })

  test('the premium screen is empty abroad without asking the server', async () => {
    useI18n.setState({ locale: 'en' as never })
    expect(await loadShowcase(), 'an international showcase lists nothing').toEqual({ subscription: null, plans: [], packs: [] })
    await expect(loadPremiumPack('arcania'), 'a premium pack page does not open abroad').rejects.toThrow('404')
  })

  test('premium requests carry the market so the server refuses them abroad as well', () => {
    useI18n.setState({ locale: 'en' as never })
    expect(marketFor('/launcher/premium'), 'premium showcase asks as the international market').toBe('EN')
    expect(marketFor('/launcher/premium/arcania'), 'premium pack asks as the international market').toBe('EN')
    useI18n.setState({ locale: 'ru' as never })
    expect(marketFor('/launcher/premium'), 'the Russian launcher sends no header, as before').toBeUndefined()
  })
})
