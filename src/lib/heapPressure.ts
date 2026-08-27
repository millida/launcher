const HIGH_PCT = 70
const ROUTINE_MS = 3_600_000

/**
 * Whether a heap sample is worth a telemetry event. A heap close to the ceiling
 * is reported once — that is the state the render process dies in, and it is the
 * only way to tell a leak in the UI from a machine that ran out of memory on its
 * own. Everything else is a slow routine sample, enough to see a session grow.
 */
export function heapEventDue(pct: number, msSinceLast: number, highSent: boolean): 'high' | 'routine' | null {
  if (pct >= HIGH_PCT && !highSent) return 'high'
  if (msSinceLast >= ROUTINE_MS) return 'routine'
  return null
}
