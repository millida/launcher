/// Marker the core puts in front of a message held by the marketplace guard.
const OFF_PLATFORM_PREFIX = 'off-platform: '

/// The reason a message was held, or null for any other failure. A held message
/// must not offer «try again»: the same text will be held again, and without the
/// reason the launcher looks broken instead of explaining the rule.
export function offPlatformReason(e: unknown): string | null {
  const text = String((e as { message?: string } | null)?.message ?? e ?? '')
  return text.startsWith(OFF_PLATFORM_PREFIX) ? text.slice(OFF_PLATFORM_PREFIX.length) : null
}
