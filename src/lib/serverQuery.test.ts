import { describe, expect, it } from 'bun:test'
import { DEFAULT_FILTERS, PAGE_SIZE, isFiltered, pageUrl, type ServerFilters } from './serverQuery'

const f = (patch: Partial<ServerFilters> = {}): ServerFilters => ({ ...DEFAULT_FILTERS, ...patch })

describe('pageUrl', () => {
  const cases: Array<[string, ServerFilters, number, string]> = [
    ['голый список — сортировка по рейтингу, страница с нуля', f(), 0, 'limit=30&offset=0&sort=rating'],
    ['вторая страница держит те же условия', f({ version: '1.21' }), PAGE_SIZE, 'limit=30&offset=30&sort=rating&version=1.21'],
    ['версия уходит в каталог, а не фильтруется по загруженной странице', f({ version: '1.21' }), 0, 'limit=30&offset=0&sort=rating&version=1.21'],
    ['лицензия и категория — фасеты API', f({ license: 'LICENSE', category: 'SURVIVAL' }), 0, 'limit=30&offset=0&sort=rating&category=SURVIVAL&license=LICENSE'],
    ['«сейчас есть игроки» = minOnline 1', f({ online: 'live' }), 0, 'limit=30&offset=0&sort=rating&minOnline=1'],
    ['порог игроков идёт числом', f({ online: '100' }), 0, 'limit=30&offset=0&sort=rating&minOnline=100'],
    ['«любой онлайн» не добавляет параметр', f({ online: '' }), 0, 'limit=30&offset=0&sort=rating'],
    ['поиск обрезается пробелами', f({ search: '  orjus ' }), 0, 'limit=30&offset=0&sort=rating&search=orjus'],
    ['сортировка «новые» = sort=new у API', f({ sort: 'new' }), 0, 'limit=30&offset=0&sort=new'],
  ]
  for (const [why, filters, offset, want] of cases) {
    it(why, () => {
      expect(pageUrl(offset, filters), why).toBe('/rating/servers?' + want)
    })
  }

  it('слишком длинный поиск режется до лимита DTO — иначе 400 читается как «рейтинг недоступен»', () => {
    const url = pageUrl(0, f({ search: 'a'.repeat(200) }))
    expect(new URLSearchParams(url.split('?')[1]).get('search')!.length, 'search ≤ 60').toBe(60)
  })
})

describe('isFiltered', () => {
  it('чистый список не считается отфильтрованным', () => {
    expect(isFiltered(f()), 'без условий — нет плашки «Сбросить»').toBe(false)
  })
  it('любое условие включает сброс', () => {
    for (const patch of [{ category: 'PVP' }, { license: 'CRACKED' }, { online: '20' }, { version: '1.21' }, { search: 'x' }, { sort: 'name' }])
      expect(isFiltered(f(patch)), JSON.stringify(patch)).toBe(true)
  })
})
