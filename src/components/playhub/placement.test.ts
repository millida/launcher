import { describe, expect, test } from 'bun:test'
import { ANARCHY_CELLS, FY_HEAD, ONEBLOCK_CELLS, FY_HEAD_CELLS, MODES_SHOWN, ROW, shelfOrder, shownCount } from './placement'

describe('«Рекомендуем» head', () => {
  test('hosting, then OneBlock, then the anarchy', () => {
    expect([...FY_HEAD], 'the owner put the anarchy as the second card right after OneBlock').toEqual([
      'hosting',
      'ONEBLOCK',
      'MCRU_ANARCHY',
    ])
  })
  test('the hosting banner is the only wide card of the head', () => {
    expect(FY_HEAD_CELLS, 'the anarchy and OneBlock are ordinary cards; a wide one pushed the feed out of the rows').toEqual({
      hosting: 2,
      MCRU_ANARCHY: 1,
      ONEBLOCK: 1,
    })
  })
})

const mode = (cat: string) => ({ def: { cat } })

describe('«Режимы» shelf', () => {
  test('folded shelf fills exactly two rows', () => {
    expect(ONEBLOCK_CELLS - 1 + ANARCHY_CELLS + MODES_SHOWN + 1, 'OneBlock on two cells, the anarchy, the tiles and «Остальные» must close both rows without a hole').toBe(2 * ROW)
  })
  test('OneBlock is the wide tile, the anarchy a single one after it', () => {
    expect([ONEBLOCK_CELLS, ANARCHY_CELLS], 'the owner kept OneBlock wide and asked for a small anarchy tile second').toEqual([2, 1])
  })

  const order: Array<[string[], string[], string]> = [
    [['BEDWARS', 'ONEBLOCK', 'SKYWARS'], ['ONEBLOCK', 'BEDWARS', 'SKYWARS'], 'OneBlock opens the shelf'],
    [['BEDWARS', 'SKYWARS'], ['BEDWARS', 'SKYWARS'], 'without OneBlock the rating order stays'],
    [['ANARCHY', 'ONEBLOCK'], ['ONEBLOCK', 'ANARCHY'], 'the category of foreign anarchy servers is an ordinary tile, not ours'],
  ]
  for (const [input, want, why] of order)
    test(why, () => {
      expect(shelfOrder(input.map(mode)).map((m) => m.def.cat), why).toEqual(want)
    })

  const counts: Array<[number, boolean, number, string]> = [
    [20, false, MODES_SHOWN, 'folded shows the fixed number of tiles'],
    [4, false, 4, 'a short list shows what there is'],
    [20, true, 20, '2 + 1 + 19 + 1 = 23 cells: «Свернуть» shares the last row'],
    [18, true, 17, '2 + 1 + 17 + 1 = 21 cells left «Свернуть» alone, the weakest mode gives way'],
  ]
  for (const [total, all, want, why] of counts)
    test(why, () => {
      expect(shownCount(total, all), why).toBe(want)
    })
})
