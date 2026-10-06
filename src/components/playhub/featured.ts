import { RECS_UID_KEY, dayIndex, hashStr } from '../../lib/recsMix'

export const PRISON_SLUG = 'prisonrpg'

export type Featured = 'anarchy' | 'prisonrpg'

const parity = (n: number): number => ((Math.floor(n) % 2) + 2) % 2

/**
 * Whose turn the featured spots are: the anarchy and PrisonRPG alternate by
 * local day, and the player's salt puts half of the audience on each one the
 * same day, so both get comparable exposure while a player keeps one face for
 * the whole day. PrisonRPG yields its turn while its catalogue card is absent.
 */
export function featuredTurn(day: number, salt: number, prisonReady: boolean): Featured {
  if (!prisonReady || !Number.isFinite(day) || !Number.isFinite(salt)) return 'anarchy'
  return parity(day + salt) === 0 ? 'anarchy' : 'prisonrpg'
}

let seed: { day: number; salt: number } | null = null

/** Frozen at the first call, so midnight or a re-render never swaps the banner under the cursor. */
function sessionSeed(): { day: number; salt: number } {
  if (seed) return seed
  let uid = 'anon'
  try {
    uid = localStorage.getItem(RECS_UID_KEY) || 'anon'
  } catch {}
  seed = { day: dayIndex(), salt: hashStr(uid) & 1 }
  return seed
}

export const featuredNow = (prisonReady: boolean): Featured => {
  const s = sessionSeed()
  return featuredTurn(s.day, s.salt, prisonReady)
}

/**
 * What a featured spot draws: the pack is still loading when it would be
 * PrisonRPG's turn, so the spot waits instead of flashing the anarchy first.
 */
export type FeaturedSpot<P> = { kind: 'anarchy' } | { kind: 'prisonrpg'; pack: P } | { kind: 'wait' }

export function featuredSpot<P>(pack: P | null | undefined, turn: (prisonReady: boolean) => Featured = featuredNow): FeaturedSpot<P> {
  if (turn(pack !== null) === 'anarchy' || pack === null) return { kind: 'anarchy' }
  return pack === undefined ? { kind: 'wait' } : { kind: 'prisonrpg', pack }
}
