// Kept out of lib/referrals: that module is in the startup bundle, the invite track is not.

/**
 * Where the invite track is filled to, in columns: the centre of column i is i, the
 * track starts at -0.5 and ends at n - 0.5. Between two steps the fill moves by the
 * share of friends counted, so "2 of 3" stands halfway from step 1 to step 3.
 */
export function trackPos(qualified: number, tiers: { friends: number }[]): number {
  let prevF = 0
  let prevP = -0.5
  for (let i = 0; i < tiers.length; i++) {
    const f = tiers[i].friends
    if (qualified < f) return prevP + ((i - prevP) * Math.max(0, qualified - prevF)) / (f - prevF)
    prevF = f
    prevP = i
  }
  return tiers.length - 0.5
}

/** How much of column i the track fill covers, 0…1. */
export const colFill = (pos: number, i: number) => Math.max(0, Math.min(1, pos - (i - 0.5)))
