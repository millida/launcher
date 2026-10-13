import type { PlusStatus } from './gameProfile'

/**
 * Whether the subscription the player is paying for has arrived. An active
 * subscription alone proves nothing for someone who already had one: the
 * payment shows as a new tier or a later paid-until date.
 */
export function purchaseLanded(before: PlusStatus | null, now: PlusStatus | null): boolean {
  if (!now?.active) return false
  if (!before?.active) return true
  if ((now.tier ?? 'PLUS') !== (before.tier ?? 'PLUS')) return true
  const was = before.paidUntil ? Date.parse(before.paidUntil) : NaN
  const is = now.paidUntil ? Date.parse(now.paidUntil) : NaN
  return Number.isFinite(was) && Number.isFinite(is) && is > was
}
