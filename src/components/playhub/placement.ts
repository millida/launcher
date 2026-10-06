import { OWN_SERVER_MODE } from '../../lib/ownServer'
import type { ForYouCard } from '../../state/promo'

/** Cells in a row of «Режимы» and «Рекомендуем» on a wide window. */
export const ROW = 5

export const FY_HEAD_CELLS: Record<ForYouCard, number> = { hosting: 2, MCRU_ANARCHY: 1, ONEBLOCK: 1 }

export const headCells = (head: readonly ForYouCard[]): number => head.reduce((n, k) => n + FY_HEAD_CELLS[k], 0)

/** The anarchy tile opens «Режимы» on two cells when the API puts it there; every mode tile after it takes one. */
export const ANARCHY_CELLS = 2

/** Mode tiles before «Остальные»: with the lead tile and that button they fill two rows. */
export const modesShown = (lead: boolean): number => 2 * ROW - (lead ? ANARCHY_CELLS : 0) - 1

/** Mode tiles after the lead: OneBlock first, the rest keep their order. */
export function shelfOrder<T extends { def: { cat: string } }>(modes: readonly T[]): T[] {
  return [...modes].sort((a, b) => Number(b.def.cat === OWN_SERVER_MODE) - Number(a.def.cat === OWN_SERVER_MODE))
}

/** The mode whose cell PrisonRPG takes on the shelf. */
export const PRISON_REPLACES = 'SURVIVAL'

/**
 * PrisonRPG in the cell of Survival, which moves to the end of the shelf behind
 * «Остальные»; without Survival in the list it goes right after OneBlock.
 */
export function withPrison<T extends { def: { cat: string } }, P>(modes: readonly T[], prison: P | null): (T | P)[] {
  if (!prison) return [...modes]
  const at = modes.findIndex((m) => m.def.cat === PRISON_REPLACES)
  if (at < 0) {
    const after = Math.min(1, modes.length)
    return [...modes.slice(0, after), prison, ...modes.slice(after)]
  }
  return [...modes.slice(0, at), prison, ...modes.slice(at + 1), modes[at] as T]
}

/**
 * How many shelf tiles to show. Unfolded, «Свернуть» must not sit alone in the
 * last row, so the weakest mode gives up its cell.
 */
export function shownCount(total: number, all: boolean, lead: boolean): number {
  if (!all) return Math.min(total, modesShown(lead))
  return ((lead ? ANARCHY_CELLS : 0) + total + 1) % ROW === 1 ? total - 1 : total
}
