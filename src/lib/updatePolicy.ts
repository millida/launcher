// Decisions of the launcher's self-update that need no network or window: is a release critical,
// how long to wait after failed checks, and which failure of a series gets reported. Kept apart
// from updater.ts, which talks to the update plugin and cannot be loaded in a test.

/** The release notes' manifest marks a release that must not wait for the player to quit. */
export function isCriticalRelease(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const doc = raw as { critical?: unknown; platforms?: unknown }
  if (doc.critical === true) return true
  // A release flagged on every platform entry is critical too (the plugin does not say which entry is ours).
  const entries = doc.platforms && typeof doc.platforms === 'object' ? Object.values(doc.platforms as object) : []
  return entries.length > 0 && entries.every((e) => !!e && typeof e === 'object' && (e as { critical?: unknown }).critical === true)
}

const MIN = 60_000
/** Checks run every 30 minutes; after failures the gap doubles up to six hours. */
const CHECK_EVERY_MS = 30 * MIN
const CHECK_MAX_GAP_MS = 6 * 60 * MIN

/** Time to wait before the next automatic check after `failures` failed ones in a row. */
export function checkGapMs(failures: number): number {
  if (failures <= 0) return CHECK_EVERY_MS
  return Math.min(CHECK_MAX_GAP_MS, CHECK_EVERY_MS * 2 ** Math.min(failures, 8))
}

/** Failed checks in a row, and when the next one is allowed. */
export class CheckBackoff {
  private failures = 0
  private notBefore = 0

  allowed(now = Date.now()): boolean {
    return now >= this.notBefore
  }

  failed(now = Date.now()): void {
    this.failures += 1
    this.notBefore = now + checkGapMs(this.failures)
  }

  worked(): void {
    this.failures = 0
    this.notBefore = 0
  }

  get streak(): number {
    return this.failures
  }
}

/**
 * Only the first failure of a series is reported: a player behind a blocked network used to send the
 * same "can't reach the update server" four to five times a day, and that was most of the error
 * traffic of the whole launcher. Anything that works ends the series.
 */
export class FailureSeries {
  private open = false

  /** True for the first failure after a success (or ever). */
  first(): boolean {
    const was = this.open
    this.open = true
    return !was
  }

  ended(): void {
    this.open = false
  }
}
