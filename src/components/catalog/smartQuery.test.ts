import { describe, expect, test } from 'bun:test'
import { smartQuery } from './smartQuery'

const PACKS = {
  categories: ['оптимизация', 'приключения', 'для игры с друзьями', 'для слабых пк', 'оружие', 'хоррор', 'хардкор', 'техника', 'выживание', 'магия', 'с квестами'],
  uses: [
    { value: 'friends', label: 'С другом' },
    { value: 'lowpc', label: 'Для слабого ПК' },
    { value: 'horror', label: 'Хоррор' },
    { value: 'beginners', label: 'Для новичков' },
    { value: 'pokemon', label: 'Покемоны' },
    { value: 'create', label: 'Create' },
  ],
}
const MODS = { categories: ['утилиты', 'приключения', 'декор', 'механика', 'оружие', 'мобы', 'оптимизация', 'еда', 'техника', 'хранилища', 'магия', 'транспорт'], uses: [] }

describe('умный поиск', () => {
  test('«хоррор хуйня» в сборках — фильтр Хоррор, текста нет', () => {
    const r = smartQuery('хоррор хуйня', 'modpacks', PACKS)
    expect(r.use).toBe('horror')
    expect(r.q).toBe('')
    expect(r.chips).toContain('Хоррор')
  })
  test('«чтоб страшно было с другом» — хоррор и с другом', () => {
    const r = smartQuery('сборку чтоб страшно было с другом', 'modpacks', PACKS)
    expect(r.chips).toEqual(expect.arrayContaining(['Хоррор', 'С другом']))
    expect(r.q).toBe('')
  })
  test('версия и ядро из текста', () => {
    const r = smartQuery('моды на магию 1.20.1 фордж', 'mods', MODS)
    expect(r.version).toBe('1.20.1')
    expect(r.loader).toBe('forge')
    expect(r.category).toBe('магия')
    expect(r.q).toBe('')
  })
  test('раздел по словам', () => {
    expect(smartQuery('шейдеры для слабого пк', 'all', null).section).toBe('shaders')
    expect(smartQuery('карта на паркур', 'mods', null).section).toBe('maps')
    expect(smartQuery('мини карта', 'mods', MODS).section).toBeNull()
  })
  test('русские названия → латиница', () => {
    expect(smartQuery('криэйт', 'mods', MODS).q).toBe('create')
    expect(smartQuery('жеи', 'mods', MODS).q).toBe('jei')
    expect(smartQuery('пиксельмон сборка', 'modpacks', PACKS).chips).toContain('Покемоны')
  })
  test('неправильная раскладка', () => {
    expect(smartQuery('[jhhjh', 'modpacks', PACKS).use).toBe('horror')
  })
  test('обычное название остаётся текстом', () => {
    expect(smartQuery('Sodium', 'mods', MODS).q).toBe('sodium')
    expect(smartQuery('Arcania', 'modpacks', PACKS).q).toBe('arcania')
  })
})
