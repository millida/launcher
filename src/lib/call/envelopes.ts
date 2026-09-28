import type { CallEvent } from './signal'

/** The mailbox drops an envelope after this long, so remembering it longer is pointless. */
const REMEMBER_MS = 2 * 60_000

const PRUNE_ABOVE = 256

/**
 * An envelope the server put straight into the socket. Anything malformed is
 * refused, and the caller then fetches the mailbox as it would on a plain poke.
 */
export function pushedEnvelope(data: unknown): CallEvent | null {
  if (!data || typeof data !== 'object') return null
  const e = (data as { e?: unknown }).e
  if (!e || typeof e !== 'object') return null
  const v = e as Record<string, unknown>
  if (typeof v.seq !== 'number' || !Number.isFinite(v.seq)) return null
  if (typeof v.callId !== 'string' || typeof v.from !== 'string' || typeof v.kind !== 'string') return null
  if (typeof v.ts !== 'number') return null
  const payload = v.data && typeof v.data === 'object' ? (v.data as Record<string, unknown>) : {}
  return { ...(v as unknown as CallEvent), data: payload }
}

/**
 * The same envelope can arrive twice, through the socket and through the catch-up
 * fetch after a reconnect; handling an offer twice breaks the connection. The key
 * includes the time because the sequence starts over when the server storage does.
 */
export function createEnvelopeLog(now: () => number = Date.now) {
  const seen = new Map<string, number>()
  return {
    admit(e: CallEvent): boolean {
      const key = `${e.seq}:${e.ts}`
      if (seen.has(key)) return false
      const at = now()
      seen.set(key, at)
      if (seen.size > PRUNE_ABOVE) {
        for (const [k, t] of seen) if (at - t > REMEMBER_MS) seen.delete(k)
      }
      return true
    },
  }
}
