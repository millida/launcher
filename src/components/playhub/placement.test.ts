import { describe, expect, test } from 'bun:test'
import { ANARCHY_CELLS, FY_HEAD, FY_HEAD_CELLS, MODES_SHOWN, ROW, shelfOrder, shownCount } from './placement'

describe('«Рекомендуем» head', () => {
  test('hosting, then the anarchy, then OneBlock', () => {
    expect([...FY_HEAD], 'the owner put the anarchy right after the hosting banner and before OneBlock').toEqual([
      'hosting',
      'MCRU_ANARCHY',
      'ONEBLOCK',
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
    expect(ANARCHY_CELLS + MODES_SHOWN + 1, 'anarchy on two cells, the tiles and «Остальные» must close both rows without a hole').toBe(2 * ROW)
  })
  test('the anarchy is the wide tile', () => {
    expect(ANARCHY_CELLS, 'the exclusive anarchy opens the shelf on two cells; OneBlock moved to one').toBe(2)
  })

  const order: Array<[string[], string[], string]> = [
    [['BEDWARS', 'ONEBLOCK', 'SKYWARS'], ['ONEBLOCK', 'BEDWARS', 'SKYWARS'], 'OneBlock is the first tile right after the anarchy'],
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
    [20, true, 20, '2 + 20 + 1 = 23 cells: «Свернуть» shares the last row'],
    [18, true, 17, '2 + 18 + 1 = 21 cells left «Свернуть» alone, the weakest mode gives way'],
  ]
  for (const [total, all, want, why] of counts)
    test(why, () => {
      expect(shownCount(total, all), why).toBe(want)
    })
})
