import { beforeEach, describe, expect, it } from 'bun:test'
import type { SiteCard } from '../components/catalog/site'

const store = new Map<string, string>()
let quotaExceeded = false
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (quotaExceeded) throw new Error('quota')
      store.set(key, value)
    },
    removeItem: (key: string) => void store.delete(key),
  },
  configurable: true,
})

const { STAR_LIMIT, reloadCatalogStars, useCatalogStars } = await import('./catalogStars')

const card = (slug: string): SiteCard => ({
  slug,
  section: 'mods',
  title: slug.toUpperCase(),
  summary: '',
  cover: null,
  icon: null,
  side: null,
  author: null,
  downloads: null,
  versions: [],
  loaders: ['fabric'],
  categories: [],
  publishedAt: null,
  updatedAt: null,
})

const slugs = () => useCatalogStars.getState().items.map((e) => e.section + '/' + e.card.slug)
const toggle = (section: string, slug: string) => useCatalogStars.getState().toggle(section, card(slug))

describe('избранное каталога', () => {
  beforeEach(() => {
    store.clear()
    quotaExceeded = false
    reloadCatalogStars()
  })

  it('звезда ставится и снимается, новое встаёт первым', () => {
    expect(toggle('mods', 'sodium')).toBe('on')
    expect(toggle('mods', 'iris')).toBe('on')
    expect(slugs()).toEqual(['mods/iris', 'mods/sodium'])
    expect(toggle('mods', 'sodium')).toBe('off')
    expect(slugs()).toEqual(['mods/iris'])
  })

  it('одинаковый slug в разных разделах — разные записи', () => {
    toggle('mods', 'faithful')
    toggle('texture-packs', 'faithful')
    toggle('mods', 'faithful')
    expect(slugs()).toEqual(['texture-packs/faithful'])
  })

  it('избранное переживает перезапуск лаунчера', () => {
    toggle('shaders', 'bsl')
    useCatalogStars.setState({ items: [] })
    reloadCatalogStars()
    expect(slugs()).toEqual(['shaders/bsl'])
    expect(useCatalogStars.getState().items[0]!.card.loaders).toEqual(['fabric'])
  })

  it('запись не удалась — звезда не загорается', () => {
    quotaExceeded = true
    expect(toggle('mods', 'sodium')).toBe('failed')
    expect(slugs()).toEqual([])
  })

  it('сверх предела новое не добавляется, а снять можно', () => {
    for (let i = 0; i < STAR_LIMIT; i++) toggle('mods', 'm' + i)
    expect(toggle('mods', 'extra')).toBe('full')
    expect(useCatalogStars.getState().items.length).toBe(STAR_LIMIT)
    expect(toggle('mods', 'm0')).toBe('off')
  })

  const broken: [string, string, string[]][] = [
    ['не JSON', '{сломано', []],
    ['не массив', '{"a":1}', []],
    ['запись без карточки', '[{"section":"mods"}]', []],
    ['карточка без названия', '[{"section":"mods","card":{"slug":"x"}}]', []],
    ['поля чужого типа', '[{"section":"mods","at":"вчера","card":{"slug":"x","title":"X","loaders":"fabric","versions":[1,"1.21"]}}]', ['mods/x']],
    ['дубли', '[{"section":"mods","card":{"slug":"x","title":"X"}},{"section":"mods","card":{"slug":"x","title":"X"}}]', ['mods/x']],
  ]
  for (const [name, raw, want] of broken)
    it('битая память не роняет каталог: ' + name, () => {
      store.set('m-catalog-stars', raw)
      reloadCatalogStars()
      expect(slugs()).toEqual(want)
      for (const e of useCatalogStars.getState().items) {
        expect(Array.isArray(e.card.loaders)).toBe(true)
        expect(e.card.versions.every((v) => typeof v === 'string')).toBe(true)
        expect(typeof e.at).toBe('number')
      }
    })
})
