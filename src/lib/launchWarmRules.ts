// When the lobby prepares a build for Play (launchWarm.ts): the rules alone, without the window.
import type { Account } from '../state/accounts'

/// One build is prepared at most this often.
export const WARM_EVERY_MS = 10 * 60 * 1000
/// The window has to stay untouched this long first.
export const WARM_QUIET_MS = 2000
/// A Microsoft token that ends within this is renewed ahead of Play: at Play it would cost a round trip.
export const MS_RENEW_AHEAD_MS = 10 * 60 * 1000

export interface WarmFacts {
  profile: string | null
  now: number
  last: number | undefined
  launching: boolean
  installing: boolean
  hidden: boolean
}

/** Whether the build should be prepared now. */
export function warmDue(f: WarmFacts): boolean {
  if (!f.profile || f.launching || f.installing || f.hidden) return false
  return f.last === undefined || f.now - f.last >= WARM_EVERY_MS
}

/** A Microsoft session that ends soon (but has not ended: an ended one is Play's to renew, with its dialog). */
export function msTokenEndsSoon(a: Pick<Account, 'kind' | 'exp'> | null, now: number): boolean {
  return !!a && a.kind === 'microsoft' && !!a.exp && a.exp > now && a.exp - now < MS_RENEW_AHEAD_MS
}
