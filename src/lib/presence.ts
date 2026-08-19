/// Status of the presence beat. The server measures the interval between beats
/// itself and credits playtime for every one of them, so "playing" is a claim
/// that costs real hours: a flag stuck on after a launch that never produced a
/// process kept farming them until the daily cap (dark_eremite, 18.08.2026 —
/// 18 h of game time locally against 70 h counted by the site).
///
/// Hence the rule: only the core knows whether a game process is alive, so
/// without the core the answer is always "lobby", whatever the caller asked for.
export function beatStatus(
  asked: string | undefined,
  hasSession: boolean,
  coreAvailable: boolean,
): 'playing' | 'lobby' {
  if (!coreAvailable) return 'lobby'
  if (asked === 'playing') return 'playing'
  return hasSession && (!asked || asked === 'lobby') ? 'playing' : 'lobby'
}
