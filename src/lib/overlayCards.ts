export const CARD_TTL_MS = 9_000

/// Bounds mirrored from the core (overlay.rs): a card shorter than this cannot
/// be read before it leaves, and a longer one stops being a notification and
/// becomes a layer over the game.
export const CARD_TTL_MIN_MS = 3_000
export const CARD_TTL_MAX_MS = 30_000

export const CARD_TTL_CHOICES = [5_000, 9_000, 15_000, 30_000]

export const clampCardTtl = (ms: number): number =>
  Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), CARD_TTL_MIN_MS), CARD_TTL_MAX_MS) : CARD_TTL_MS

/// A hovered card stops its own clock. Without a ceiling on that, a pointer
/// resting in the corner where cards appear leaves an always-on-top card on
/// screen with nothing left to take it down.
export const CARD_MAX_MS = 45_000

export interface TimedCard {
  ts: number
  expires: number
}

export const cardDeadline = (card: TimedCard): number => Math.min(card.expires, card.ts + CARD_MAX_MS)

export function holdCards<T extends TimedCard>(cards: T[], heldMs: number): T[] {
  if (heldMs <= 0) return cards
  return cards.map((c) => ({ ...c, expires: Math.min(c.expires + heldMs, c.ts + CARD_MAX_MS) }))
}

export function freshCards<T extends TimedCard>(cards: T[], now: number, shown: number): T[] {
  return cards.filter((c) => cardDeadline(c) > now).slice(-shown)
}
