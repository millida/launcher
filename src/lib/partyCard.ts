import { normalizePartyCode, partyCodeOk } from './party'

export const PARTY_PREFIX = '⟪party⟫'

export interface PartyCardData {
  code: string
  size: number
  capacity: number
  /** Unix ms after which the code no longer lets anyone in. */
  expiresAt: number
}

const small = (n: unknown, max: number): number => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0
}

export function encodePartyCard(d: PartyCardData): string {
  return PARTY_PREFIX + JSON.stringify({ code: normalizePartyCode(d.code), size: d.size, capacity: d.capacity, exp: d.expiresAt })
}

/// The text comes from another player, so every field is checked before it reaches a button.
export function parsePartyCard(text: string): PartyCardData | null {
  if (!text || !text.startsWith(PARTY_PREFIX)) return null
  try {
    const o = JSON.parse(text.slice(PARTY_PREFIX.length))
    const code = normalizePartyCode(String(o?.code ?? ''))
    if (!partyCodeOk(code)) return null
    return { code, size: small(o.size, 99), capacity: small(o.capacity, 99), expiresAt: small(o.exp, Number.MAX_SAFE_INTEGER) }
  } catch {
    return null
  }
}

export const partyCardExpired = (d: PartyCardData, now = Date.now()): boolean => d.expiresAt > 0 && now > d.expiresAt
