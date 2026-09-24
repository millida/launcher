import { beforeEach, describe, expect, it } from 'bun:test'
import {
  addOutfit,
  loadOutfits,
  nextOutfitName,
  OUTFITS_LIMIT,
  parseOutfits,
  removeOutfit,
  renameOutfit,
  sameLook,
  saveOutfits,
  splitWearable,
  type Look,
} from './outfits'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
  configurable: true,
})

const look = (over: Partial<Look> = {}): Look => ({
  skin: { url: 'https://x/skin.png', slim: false, wardrobeId: 'w-1' },
  cape: 'none',
  cosmetics: [{ id: 'HAT', slot: 'HEAD', variant: 'red' }],
  ...over,
})

describe('образы', () => {
  beforeEach(() => store.clear())

  it('новый образ получает имя «Образ N» и копию набора', () => {
    const cur = look()
    const list = addOutfit([], cur, 'a')
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Образ 1')
    cur.cosmetics.push({ id: 'WINGS', slot: 'BACK' })
    expect(list[0].cosmetics).toHaveLength(1)
    expect(addOutfit(list, look(), 'b')[1].name).toBe('Образ 2')
  })

  it('номер берётся свободный: после удаления второго не будет двух «Образ 3»', () => {
    let list = addOutfit(addOutfit(addOutfit([], look(), 'a'), look(), 'b'), look(), 'c')
    list = removeOutfit(list, 'b')
    expect(nextOutfitName(list)).toBe('Образ 2')
  })

  it('на лимите новый образ не добавляется', () => {
    let list = addOutfit([], look(), 'x0')
    for (let i = 1; i < OUTFITS_LIMIT + 3; i++) list = addOutfit(list, look(), 'x' + i)
    expect(list).toHaveLength(OUTFITS_LIMIT)
  })

  it('переименование чистит пробелы, пустое имя не принимается', () => {
    const list = addOutfit([], look(), 'a')
    expect(renameOutfit(list, 'a', '  Для   PvP ')[0].name).toBe('Для PvP')
    expect(renameOutfit(list, 'a', '   ')[0].name).toBe('Образ 1')
    expect(renameOutfit(list, 'a', 'я'.repeat(60))[0].name.length).toBe(24)
  })

  it('образы у каждого аккаунта свои и переживают перезапуск', () => {
    saveOutfits('acc-1', addOutfit([], look(), 'a'))
    expect(loadOutfits('acc-1').map((o) => o.id)).toEqual(['a'])
    expect(loadOutfits('acc-2')).toEqual([])
  })

  it('битая запись в памяти не роняет экран', () => {
    store.set('m-outfits:acc-1', '{сломано')
    expect(loadOutfits('acc-1')).toEqual([])
    expect(parseOutfits([null, { id: 1 }, { id: 'a', name: 'А', skin: { url: '' } }])).toEqual([])
    const ok = parseOutfits([{ id: 'a', name: 'А', skin: { url: 'u' }, cosmetics: [{ id: 1 }, { id: 'H', slot: 'HEAD' }] }])
    expect(ok[0].cape).toBe('none')
    expect(ok[0].cosmetics).toEqual([{ id: 'H', slot: 'HEAD', variant: undefined }])
  })

  it('активный образ узнаётся при любом порядке косметики', () => {
    const a = look({ cosmetics: [{ id: 'HAT', slot: 'HEAD' }, { id: 'WINGS', slot: 'BACK' }] })
    const b = look({ cosmetics: [{ id: 'WINGS', slot: 'BACK' }, { id: 'HAT', slot: 'HEAD' }] })
    expect(sameLook(a, b)).toBe(true)
    expect(sameLook(a, { ...b, cape: 'cat:1' })).toBe(false)
    expect(sameLook(a, { ...b, skin: { ...b.skin, slim: true } })).toBe(false)
  })

  it('закрытая косметика отделяется от той, что можно надеть', () => {
    const { wear, skipped } = splitWearable(
      [
        { id: 'FREE', slot: 'HEAD' },
        { id: 'PAID', slot: 'BACK' },
      ],
      (id) => id === 'FREE',
    )
    expect(wear.map((c) => c.id)).toEqual(['FREE'])
    expect(skipped.map((c) => c.id)).toEqual(['PAID'])
  })
})
