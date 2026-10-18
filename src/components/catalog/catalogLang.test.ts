import { describe, expect, it } from 'bun:test'
import type { Locale } from '../../i18n'
import { catalogLang, withCatalogLang } from './catalogLang'
import { hitKey, itemKey, listingKey } from './site'

describe('withCatalogLang', () => {
  const cases: { why: string; path: string; locale: Locale; want: string }[] = [
    { why: 'a Russian interface keeps the old address, so server and disk caches stay valid', path: '/catalog/items/sodium', locale: 'ru', want: '/catalog/items/sodium' },
    { why: 'a Russian listing with filters is not touched either', path: '/catalog/listing?section=mods', locale: 'ru', want: '/catalog/listing?section=mods' },
    { why: 'an English interface asks the catalogue for English text', path: '/catalog/items/sodium', locale: 'en', want: '/catalog/items/sodium?lang=en' },
    { why: 'a path that already has a query gets the language appended, not a second question mark', path: '/catalog/listing?section=mods&page=2', locale: 'en', want: '/catalog/listing?section=mods&page=2&lang=en' },
    { why: 'a bare question mark is not followed by a stray ampersand', path: '/catalog/search?', locale: 'en', want: '/catalog/search?lang=en' },
    { why: 'an interface without a catalogue translation falls back to English like the UI itself', path: '/catalog/authors/x', locale: 'de', want: '/catalog/authors/x?lang=en' },
  ]
  for (const c of cases) {
    it(c.why, () => {
      expect(withCatalogLang(c.path, c.locale), `${c.locale} ${c.path}: ${c.why}`).toBe(c.want)
    })
  }

  it('the language is decided only by Russian versus everything else', () => {
    expect(catalogLang('ru'), 'Russian must send no language parameter at all').toBeNull()
    expect(catalogLang('en'), 'English must ask for English text').toBe('en')
  })
})

describe('catalog cache keys', () => {
  const query = { section: 'mods' as const, q: 'sodium' }
  const cases: { why: string; ru: string; en: string; ruWant: string }[] = [
    {
      why: 'a listing fetched in one language must not be served after switching to the other',
      ru: listingKey(query, 'ru'),
      en: listingKey(query, 'en'),
      ruWant: 'site:/catalog/listing?section=mods&q=sodium&perPage=20',
    },
    { why: 'an item page cached in Russian must not show up in the English interface', ru: itemKey('sodium', 'ru'), en: itemKey('sodium', 'en'), ruWant: 'site:item:sodium' },
    { why: 'install rows carry the translated title and summary, so they are split by language too', ru: hitKey('sodium', 'ru'), en: hitKey('sodium', 'en'), ruWant: 'site:hit:sodium' },
  ]
  for (const c of cases) {
    it(c.why, () => {
      expect(c.en, c.why).not.toBe(c.ru)
      expect(c.ru, 'the Russian key must stay as before, or every saved listing on disk is lost').toBe(c.ruWant)
    })
  }

  it('the listing key is the address the launcher requests', () => {
    expect(listingKey(query, 'en').slice(5), 'loadListing requests key.slice(5); the language has to reach the server').toBe('/catalog/listing?section=mods&q=sodium&perPage=20&lang=en')
  })
})
