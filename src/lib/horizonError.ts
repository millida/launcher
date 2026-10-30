import { HORIZON_FAIL_PREFIX } from '../ipc/commands'

/** The reason Horizon gave, when a launch error came from it; null for every other error. */
export function horizonReason(err: unknown): string | null {
  const text = String(err && (err as Error).message ? (err as Error).message : err)
  const at = text.indexOf(HORIZON_FAIL_PREFIX)
  if (at < 0) return null
  return text.slice(at + HORIZON_FAIL_PREFIX.length).trim() || null
}
