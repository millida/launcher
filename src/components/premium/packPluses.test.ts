import { describe, expect, test } from 'bun:test'
import { packPluses, type DescBlock } from './packView'

const inside = (items: string[]): DescBlock[] => [
  { type: 'paragraph', text: 'Intro' },
  { type: 'heading', text: 'Что внутри' },
  { type: 'list', items },
]

const cases: { why: string; items: string[]; want: string[] }[] = [
  {
    why: 'benefit after a spaced dash wins over the mod name, the modal must not list mod names when a benefit exists',
    items: ['Create 6 и Create: Aeronautics — дирижабли, самолёты и летающие крепости', 'Better Combat — бой'],
    want: ['Дирижабли, самолёты и летающие крепости', 'Бой'],
  },
  {
    why: 'a long benefit is cut to its first clause instead of turning a checklist row into a paragraph',
    items: ['TACZ — огнестрельное оружие, с совместимостью для летательных аппаратов'],
    want: ['Огнестрельное оружие'],
  },
  {
    why: 'items with a benefit come first, heads only fill the remaining slots',
    items: ['Пять классов: паладин, лучник', 'Ice and Fire — драконы'],
    want: ['Драконы', 'Пять классов'],
  },
  {
    why: 'without any dash the old head rule stays, so packs with plain lists keep their checklist',
    items: ['Пять классов: паладин', 'Очень длинный заголовок пункта из многих слов'],
    want: ['Пять классов'],
  },
  {
    why: 'duplicate benefits collapse, otherwise two rows read the same',
    items: ['A — боссы', 'B — Боссы', 'C — магия'],
    want: ['Боссы', 'Магия'],
  },
  {
    why: 'hyphenated names are not a benefit separator',
    items: ['Sky-Villages'],
    want: ['Sky-Villages'],
  },
]

describe('packPluses', () => {
  for (const c of cases)
    test(c.why, () => {
      expect(packPluses(inside(c.items)), c.why).toEqual(c.want)
    })

  test('caps the checklist at four rows', () => {
    const items = ['a — один', 'b — два', 'c — три', 'd — четыре', 'e — пять']
    expect(packPluses(inside(items)), 'the modal grid has room for four rows only').toHaveLength(4)
  })
})
