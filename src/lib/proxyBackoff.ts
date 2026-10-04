const FAILURE_TTL_MS = 10 * 60 * 1000
const OUTAGE_DEFAULT_MS = 60 * 1000
const RETRY_AFTER_CAP_MS = 30 * 60 * 1000
const LIMIT = 512

export type ProxyVerdict =
  | { kind: 'answered' }
  | { kind: 'key-failed' }
  | { kind: 'outage'; waitMs: number }
  | { kind: 'ignored' }

/**
 * 503 and 429 come from the backend breaker and rate limiter and cover every path;
 * 502/504 mean the upstream refused this one request. `status` null = no answer.
 */
export function proxyVerdict(status: number | null, retryAfter: string | null): ProxyVerdict {
  if (status === null) return { kind: 'key-failed' }
  if (status >= 200 && status < 300) return { kind: 'answered' }
  if (status === 503 || status === 429) {
    const seconds = retryAfter && /^\s*\d+\s*$/.test(retryAfter) ? Number(retryAfter) : NaN
    const waitMs = Number.isFinite(seconds) ? Math.min(seconds * 1000, RETRY_AFTER_CAP_MS) : OUTAGE_DEFAULT_MS
    return { kind: 'outage', waitMs }
  }
  if (status === 502 || status === 504) return { kind: 'key-failed' }
  return { kind: 'ignored' }
}

export class ProxyBackoff {
  private failures = new Map<string, number>()
  private outageUntil = 0

  constructor(private readonly now: () => number = Date.now) {}

  skipped(key: string): boolean {
    const now = this.now()
    if (now < this.outageUntil) return true
    const until = this.failures.get(key)
    if (until === undefined) return false
    if (now < until) return true
    this.failures.delete(key)
    return false
  }

  note(key: string, verdict: ProxyVerdict): void {
    const now = this.now()
    if (verdict.kind === 'answered') this.failures.delete(key)
    else if (verdict.kind === 'outage') this.outageUntil = Math.max(this.outageUntil, now + verdict.waitMs)
    else if (verdict.kind === 'key-failed') {
      if (!this.failures.has(key) && this.failures.size >= LIMIT) this.evict(now)
      this.failures.set(key, now + FAILURE_TTL_MS)
    }
  }

  get size(): number {
    return this.failures.size
  }

  clear(): void {
    this.failures.clear()
    this.outageUntil = 0
  }

  private evict(now: number): void {
    for (const [key, until] of this.failures) if (until <= now) this.failures.delete(key)
    if (this.failures.size < LIMIT) return
    let firstKey = ''
    let firstUntil = Infinity
    for (const [key, until] of this.failures) {
      if (until < firstUntil) {
        firstUntil = until
        firstKey = key
      }
    }
    this.failures.delete(firstKey)
  }
}

/** One window for every CurseForge proxy call of the session. */
export const cfProxyBackoff = new ProxyBackoff()

export const PROXY_TIMINGS = { FAILURE_TTL_MS, OUTAGE_DEFAULT_MS, RETRY_AFTER_CAP_MS, LIMIT }
