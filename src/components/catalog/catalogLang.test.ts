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
    { why: 'a German interface asks for German text, the server falls back to English where it has none', path: '/catalog/authors/x', locale: 'de', want: '/catalog/authors/x?lang=de' },
    { why: 'Polish is a public interface language with its own catalogue text', path: '/catalog/items/sodium', locale: 'pl', want: '/catalog/items/sodium?lang=pl' },
    { why: 'Turkish is a public interface language with its own catalogue text', path: '/catalog/items/sodium', locale: 'tr', want: '/catalog/items/sodium?lang=tr' },
    { why: 'Spanish is a public interface language with its own catalogue text', path: '/catalog/items/sodium', locale: 'es', want: '/catalog/items/sodium?lang=es' },
    { why: 'Brazilian Portuguese keeps its region tag, the server accepts pt-BR as is', path: '/catalog/listing?section=mods', locale: 'pt-BR', want: '/catalog/listing?section=mods&lang=pt-BR' },
    { why: 'Ukrainian sends itself: the server reads it as the ruble market where Russian packs are sold', path: '/catalog/items/arcania-2', locale: 'uk', want: '/catalog/items/arcania-2?lang=uk' },
    { why: 'an interface without a catalogue translation falls back to English like the UI itself', path: '/catalog/authors/x', locale: 'fr', want: '/catalog/authors/x?lang=en' },
    { why: 'a right-to-left interface without a catalogue translation also reads English', path: '/catalog/items/sodium', locale: 'ar', want: '/catalog/items/sodium?lang=en' },
  ]
  for (const c of cases) {
    it(c.why, () => {
      expect(withCatalogLang(c.path, c.locale), `${c.locale} ${c.path}: ${c.why}`).toBe(c.want)
    })
  }

  it('Russian sends nothing, translated languages send themselves, the rest send English', () => {
    expect(catalogLang('ru'), 'Russian must send no language parameter at all').toBeNull()
    expect(catalogLang('en'), 'English must ask for English text').toBe('en')
    expect(catalogLang('pt-BR'), 'Brazilian Portuguese must ask for its own text, not English').toBe('pt-BR')
    expect(catalogLang('zh'), 'a language the catalogue does not translate must read English, never Russian').toBe('en')
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

  it('every catalogue language gets its own cache entry', () => {
    const langs: Locale[] = ['ru', 'en', 'de', 'pl', 'tr', 'pt-BR', 'es']
    const keys = langs.map((l) => listingKey(query, l))
    expect(new Set(keys).size, 'two languages sharing a listing key would show one language in the other interface').toBe(langs.length)
    expect(new Set(langs.map((l) => itemKey('sodium', l))).size, 'item pages must be cached per language').toBe(langs.length)
  })

  it('the listing key is the address the launcher requests', () => {
    expect(listingKey(query, 'en').slice(5), 'loadListing requests key.slice(5); the language has to reach the server').toBe('/catalog/listing?section=mods&q=sodium&perPage=20&lang=en')
  })
})
