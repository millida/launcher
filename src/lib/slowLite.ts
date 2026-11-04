/**
 * Light graphics in practice. A PC can pass the hardware rules (many cores, plenty of memory) and
 * still have one slow core: the interface and 3D share a thread, and frames run 100-300 ms in a
 * row. deviceTier cannot see that, so the launcher watches the long frames themselves (jank.ts):
 * three fits of stutter in a session turn on the weak PC mode for a week. The manual choice Full
 * wins (deviceTier.weakVerdict). The fit counter is stutter.ts: it loads after STUTTER_GRACE_MS
 * and stays out of the startup set.
 */

export const SLOW_LITE_KEY = 'm-slow-lite-since'
export const SLOW_LITE_TTL_MS = 7 * 24 * 3600 * 1000

/** Long frames are expected after start and a screen change: loading, shader compilation. */
export const STUTTER_GRACE_MS = 15_000

/** The launcher switched itself to light graphics for a week: it kept stuttering on this PC. */
export function slowLite(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(SLOW_LITE_KEY) || 0) || 0
    return at > 0 && now - at < SLOW_LITE_TTL_MS
  } catch {
    return false
  }
}
