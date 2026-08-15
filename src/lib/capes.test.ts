import { describe, expect, test } from 'bun:test'
import { capeKey, dedupeByTitle, dedupeCapes, textureHash } from './capes'

const MOJANG = 'https://textures.minecraft.net/texture/'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('ключ плаща', () => {
  // (адрес → ключ, зачем кейс закреплён)
  const cases: [string, string, string][] = [
    [MOJANG + HASH_A, HASH_A, 'плащи лицензии опознаются по хешу текстуры, а не по адресу'],
    [MOJANG + HASH_A.toUpperCase(), HASH_A.toUpperCase(), 'регистр в адресе Mojang встречается и остаётся значимым'],
    ['https://cdn.millida.trade/launcher/capes/x-1.png', '', 'у наших плащей хеша в адресе нет'],
    ['', '', 'пустой адрес не даёт ключа — такие карточки не схлопываются между собой'],
  ]
  for (const [url, expected, why] of cases) {
    test(why, () => {
      expect(textureHash(url)).toBe(expected)
    })
  }
})

test('плащ аккаунта и плащ каталога с одним адресом — одна карточка', () => {
  const url = 'https://cdn.millida.trade/launcher/capes/e0f-2cf.png'
  const list = dedupeCapes([
    { url, name: 'Любимец', wardrobeId: 'w1' },
    { url, name: 'dark_eremite', onAccount: true },
  ])
  expect(list.length).toBe(1)
  expect(list[0].wardrobeId).toBe('w1')
  // Признак «надет на аккаунте» обязан пережить схлопывание: по нему карточка
  // помечается как активная.
  expect(list[0].onAccount).toBe(true)
})

test('идентификаторы лицензии подмешиваются в выжившую карточку', () => {
  const list = dedupeCapes([
    { url: MOJANG + HASH_A, name: 'Migrator', wardrobeId: 'w1' },
    { url: MOJANG + HASH_A, name: 'Migrator', accId: 'acc1', msId: 'ms1', active: true },
  ])
  expect(list.length).toBe(1)
  expect(list[0].accId).toBe('acc1')
  expect(list[0].msId).toBe('ms1')
  expect(list[0].active).toBe(true)
})

test('разные плащи не схлопываются', () => {
  const list = dedupeCapes([
    { url: MOJANG + HASH_A, name: 'Migrator' },
    { url: MOJANG + HASH_B, name: 'MineCon 2011' },
    { url: 'https://cdn.millida.trade/launcher/capes/x.png', name: 'Путник' },
  ])
  expect(list.length).toBe(3)
})

test('копии одного плаща в каталоге аккаунта схлопываются по имени', () => {
  // Прошлые версии перезаливали PNG на каждое «Применить»: адрес новый, имя то же.
  const list = dedupeByTitle([
    { url: 'https://cdn.millida.trade/launcher/capes/e0f-1.png', name: 'Ветеран', wardrobeId: 'w1' },
    { url: 'https://cdn.millida.trade/launcher/capes/e0f-2.png', name: ' ветеран ', wardrobeId: 'w2' },
    { url: 'https://cdn.millida.trade/launcher/capes/e0f-3.png', name: 'Страж', wardrobeId: 'w3' },
  ])
  expect(list.map((c) => c.wardrobeId)).toEqual(['w1', 'w3'])
})

test('порядок источников сохраняется', () => {
  const list = dedupeCapes([
    { url: MOJANG + HASH_A, name: 'первый' },
    { url: MOJANG + HASH_B, name: 'второй' },
    { url: MOJANG + HASH_A, name: 'повтор первого' },
  ])
  expect(list.map((c) => c.name)).toEqual(['первый', 'второй'])
})

test('ключом плаща каталога Millida служит его адрес', () => {
  expect(capeKey({ url: 'https://millida.net/capes/veteran.png', name: 'Ветеран' })).toBe(
    'https://millida.net/capes/veteran.png',
  )
})
