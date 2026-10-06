import { describe, expect, test } from 'bun:test'
import { ANARCHY_CELLS, FY_HEAD_CELLS, ROW, headCells, modesShown, shelfOrder, shownCount, withPrison } from './placement'
import { ANARCHY } from '../../lib/ownServer'
import { ANARCHY_ID, DEFAULT_PROMO } from '../../state/promo'

describe('«Рекомендуем» head', () => {
  test('hosting, then the anarchy, then OneBlock by default', () => {
    expect([...DEFAULT_PROMO.forYou], 'the owner put the anarchy right after the hosting banner and before OneBlock').toEqual([
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
  test('a hidden card frees its cell for the feed', () => {
    expect(headCells(['hosting', 'ONEBLOCK']), 'the feed fills what the head does not take').toBe(3)
  })
  test('the promo id is the anarchy mode key', () => {
    expect(ANARCHY_ID, 'the API names the anarchy by the key the cards and clicks use').toBe(ANARCHY.mode)
  })
})

const mode = (cat: string) => ({ def: { cat } })

describe('«Режимы» shelf', () => {
  for (const lead of [true, false])
    test('folded shelf fills exactly two rows ' + (lead ? 'with' : 'without') + ' the anarchy', () => {
      expect((lead ? ANARCHY_CELLS : 0) + modesShown(lead) + 1, 'the lead tile, the tiles and «Остальные» must close both rows without a hole').toBe(2 * ROW)
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

  const counts: Array<[number, boolean, boolean, number, string]> = [
    [20, false, true, 7, 'folded shows the fixed number of tiles'],
    [20, false, false, 9, 'without the anarchy two more tiles fit'],
    [4, false, true, 4, 'a short list shows what there is'],
    [20, true, true, 20, '2 + 20 + 1 = 23 cells: «Свернуть» shares the last row'],
    [18, true, true, 17, '2 + 18 + 1 = 21 cells left «Свернуть» alone, the weakest mode gives way'],
    [20, true, false, 19, '20 + 1 = 21 cells without the anarchy, the weakest mode gives way'],
  ]
  for (const [total, all, lead, want, why] of counts)
    test(why, () => {
      expect(shownCount(total, all, lead), why).toBe(want)
    })
})

describe('PrisonRPG on the «Режимы» shelf', () => {
  const PRISON = { def: { cat: 'prisonrpg' } }
  const cases: Array<[string[], boolean, string[], string]> = [
    [['ONEBLOCK', 'SURVIVAL', 'BEDWARS'], true, ['ONEBLOCK', 'prisonrpg', 'BEDWARS', 'SURVIVAL'], 'the owner put PrisonRPG in the Survival cell, Survival goes behind «Остальные»'],
    [['ONEBLOCK', 'BEDWARS', 'SKYWARS'], true, ['ONEBLOCK', 'prisonrpg', 'BEDWARS', 'SKYWARS'], 'without Survival PrisonRPG still stands right after OneBlock'],
    [[], true, ['prisonrpg'], 'an empty rating still shows PrisonRPG'],
    [['ONEBLOCK', 'SURVIVAL'], false, ['ONEBLOCK', 'SURVIVAL'], 'without the catalogue card Survival keeps its cell'],
  ]
  for (const [input, ready, want, why] of cases)
    test(why, () => {
      expect(withPrison(input.map(mode), ready ? PRISON : null).map((m) => m.def.cat), why).toEqual(want)
    })
})
