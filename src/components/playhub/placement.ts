import { ANARCHY, OWN_SERVER_MODE } from '../../lib/ownServer'

/** Cells in a row of «Режимы» and «Рекомендуем» on a wide window. */
export const ROW = 5

/** Head of «Рекомендуем»: the hosting banner, then our anarchy, then OneBlock. */
export const FY_HEAD = ['hosting', ANARCHY.mode, OWN_SERVER_MODE] as const
export type FyHead = (typeof FY_HEAD)[number]
export const FY_HEAD_CELLS: Record<FyHead, number> = { hosting: 2, [ANARCHY.mode]: 1, [OWN_SERVER_MODE]: 1 }

/** The anarchy tile opens «Режимы» on two cells; every mode tile after it takes one. */
export const ANARCHY_CELLS = 2
/** Mode tiles before «Остальные»: with the anarchy and that button they fill two rows. */
export const MODES_SHOWN = 7

/** Mode tiles after the anarchy: OneBlock first, the rest keep their order. */
export function shelfOrder<T extends { def: { cat: string } }>(modes: readonly T[]): T[] {
  return [...modes].sort((a, b) => Number(b.def.cat === OWN_SERVER_MODE) - Number(a.def.cat === OWN_SERVER_MODE))
}

/**
 * How many shelf tiles to show. Unfolded, «Свернуть» must not sit alone in the
 * last row, so the weakest mode gives up its cell.
 */
export function shownCount(total: number, all: boolean): number {
  if (!all) return Math.min(total, MODES_SHOWN)
  return (ANARCHY_CELLS + total + 1) % ROW === 1 ? total - 1 : total
}
