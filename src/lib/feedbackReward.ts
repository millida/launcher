export const FEEDBACK_WEEK_MS = 7 * 86400_000

/** When the feedback reward opens again, read from the server's answer; a "not yet" without a date means a week. */
export function rewardOpensAt(ready: boolean, nextAt: string | null | undefined, now: number): number {
  if (ready) return now
  const next = nextAt ? Date.parse(nextAt) : NaN
  return Number.isFinite(next) ? next : now + FEEDBACK_WEEK_MS
}

export function rewardReady(opensAt: number, now: number): boolean {
  return now >= opensAt
}
