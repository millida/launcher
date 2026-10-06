import { describe, expect, test } from 'bun:test'
import { shortTitle, downloadsShort, exclusivesOf, genresOf, shortPitch, tabLabel, iconOf, parseReqs, splitTitle, storyOf, withoutModCount } from './premiumPackData'
import type { DescBlock } from './packView'

const arcania: DescBlock[] = [
  { type: 'paragraph', text: 'Arcania — сборка со своим сюжетом.' },
  { type: 'heading', text: 'Сюжет и диалоги' },
  { type: 'image', src: 'https://cdn/g2.jpg', alt: 'Диалог' },
  { type: 'paragraph', text: 'Каждый персонаж говорит с тобой сам. Ты выбираешь, что ответить.' },
  { type: 'heading', text: 'Кот Сёма' },
  { type: 'paragraph', text: 'Верный спутник на всё путешествие.' },
  { type: 'heading', text: 'Мир и графика' },
  { type: 'list', items: ['Новые биомы и подземелья', 'Шейдеры Complementary Reimagined, Complementary Unbound и Solas'] },
  { type: 'heading', text: 'Системные требования' },
  {
    type: 'paragraph',
    text: 'Минимум — 4 ГБ оперативной памяти, i3 или Ryzen 3 и видеокарта на 2 ГБ; для комфортной игры — 8 ГБ, i5 или Ryzen 5 и видеокарта на 4 ГБ. Доступ — по подписке.',
  },
  { type: 'heading', text: 'Как установить' },
  { type: 'paragraph', text: 'Нажми «Установить».' },
]

describe('premium pack page data', () => {
  test('the description splits into lead, chapters and requirements; install steps are dropped', () => {
    const s = storyOf(arcania)
    expect(s.lead).toEqual(['Arcania — сборка со своим сюжетом.'])
    expect(s.chapters.map((c) => c.title)).toEqual(['Сюжет и диалоги', 'Кот Сёма', 'Мир и графика'])
    expect(s.chapters[0]!.image?.src).toBe('https://cdn/g2.jpg')
    expect(s.reqs).toContain('Минимум')
  })

  test('the mod count is cut out of the author text, the rest of the sentence stays', () => {
    expect(withoutModCount('Minecraft 1.20.1 на Fabric, 291 мод, около 3 ГБ на диске.')).toBe('Minecraft 1.20.1 на Fabric, около 3 ГБ на диске.')
    expect(withoutModCount('Сборка на 1.21.1, 478 модов.')).toBe('Сборка на 1.21.1.')
    expect(withoutModCount('Пять классов и 100 умений')).toBe('Пять классов и 100 умений')
  })

  test('own story, bosses and companion become the exclusive block; shaders and other mods do not', () => {
    const story = storyOf(arcania)
    const ex = exclusivesOf(story, 'Сюжетная RPG с самописными боссами')
    expect(ex.map((x) => x.title)).toEqual(['Сюжет и диалоги', 'Кот Сёма'])
    expect(ex[0]).toMatchObject({
      tab: 'Сюжет',
      text: ['Каждый персонаж говорит с тобой сам. Ты выбираешь, что ответить.'],
      icon: 'i-book',
      image: 'https://cdn/g2.jpg',
    })
    // Автор не написал, что сделал своё, — эксклюзива нет (ATM10 из чужих модов).
    const atm = storyOf([
      { type: 'paragraph', text: 'Сборка обо всём сразу.' },
      { type: 'heading', text: 'Миры и боссы' },
      { type: 'list', items: ["Twilight Forest и L_Ender's Cataclysm — боссы"] },
    ])
    expect(exclusivesOf(atm, 'Техника, магия и 64 главы квестов')).toEqual([])
  })

  test('chapter tabs get short names', () => {
    expect(['Сюжет и диалоги', 'Самописные боссы', 'Классы и древо навыков', 'Кот Сёма'].map(tabLabel)).toEqual(['Сюжет', 'Боссы', 'Классы', 'Кот Сёма'])
  })

  test('chapter icons follow the meaning of the title', () => {
    expect(iconOf('Кот Сёма')).toBe('i-paw')
    expect(iconOf('Техника и автоматизация')).toBe('i-hammer')
    expect(iconOf('Сюжет и диалоги')).toBe('i-book')
  })

  test('requirements become two columns, the rest of the paragraph stays a note', () => {
    const r = parseReqs(storyOf(arcania).reqs)
    expect(r?.min).toEqual([
      { label: 'Память', value: '4 ГБ' },
      { label: 'Процессор', value: 'i3 или Ryzen 3' },
      { label: 'Видеокарта', value: '2 ГБ видеопамяти' },
    ])
    expect(r?.rec[0]).toEqual({ label: 'Память', value: '8 ГБ' })
    expect(r?.note).toBe('Доступ — по подписке.')
    expect(parseReqs('Нужен хороший компьютер.')).toBeNull()
  })

  test('a trailing version leaves the title and becomes a chip', () => {
    expect(splitTitle('Arcania 1.4.3', '1.4.3')).toEqual({ name: 'Arcania', version: '1.4.3' })
    expect(splitTitle('All the Mods 10 - ATM10', '7.1')).toEqual({ name: 'All the Mods 10 - ATM10', version: '7.1' })
  })

  test('studio cards: short downloads, a pitch cut by whole phrases, genres by words', () => {
    expect(downloadsShort(940)).toBe('940')
    expect(downloadsShort(10890)).toBe('10,9 тыс.')
    expect(downloadsShort(999800)).toBe('1 млн')
    expect(downloadsShort(123456)).toBe('123 тыс.')
    expect(downloadsShort(1240000)).toBe('1,2 млн')
    expect(shortPitch('Городской зомби-апокалипсис: зачистка районов, оружие, техника, машины и поиски лекарства.')).toBe(
      'Городской зомби-апокалипсис',
    )
    expect(shortPitch('Уютное выживание: своя усадьба, огород, кухня')).toBe('Уютное выживание: своя усадьба, огород')
    expect(shortTitle('DeceasedCraft - Urban Zombie Apocalypse')).toBe('DeceasedCraft')
    expect(shortTitle('Arcania 1.4.3')).toBe('Arcania')
    expect(shortTitle('Otherworld [Dungeons & Dragons]')).toBe('Otherworld')
    expect(shortTitle('Prominence™ II: Hasturian Era')).toBe('Prominence™ II')
    expect(shortPitch('Короткая суть.')).toBe('Короткая суть')
    expect(shortPitch('Оченьдлинноеслово '.repeat(8)).endsWith('…')).toBe(true)
    expect(genresOf('DeceasedCraft - Urban Zombie Apocalypse', 'Городской зомби-апокалипсис')).toEqual(['horror'])
    expect(genresOf('Create: Stranded at Sea', 'Выживание на плоту')).toEqual(['tech', 'survival'])
  })
})
