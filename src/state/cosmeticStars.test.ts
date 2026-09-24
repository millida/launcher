import { beforeEach, describe, expect, it } from 'bun:test'
import { isStarred, starredFirst, starredIds, toggleStar } from './cosmeticStars'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
  configurable: true,
})

describe('избранные вещи', () => {
  beforeEach(() => store.clear())

  it('звёздочка ставится и снимается одним нажатием', () => {
    expect(isStarred('WINGS')).toBe(false)
    toggleStar('WINGS')
    expect(isStarred('WINGS')).toBe(true)
    toggleStar('WINGS')
    expect(starredIds()).toEqual([])
  })

  it('избранное поднимается наверх, остальное держит порядок', () => {
    toggleStar('b')
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(starredFirst(items, (i) => i.id, starredIds()).map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('без избранного порядок не трогаем', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(starredFirst(items, (i) => i.id, [])).toBe(items)
  })

  it('битая запись в памяти не роняет экран', () => {
    store.set('m-cosmetic-stars', '{сломано')
    expect(starredIds()).toEqual([])
  })
})
