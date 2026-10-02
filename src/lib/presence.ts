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

export interface BeatState {
  status: string
  server: string | null
  serverIp: string | null
  build: string | null
  gameNick: string | null
  catalogPack: string | null
  discordUserId: string | null
}

export function beatKey(s: BeatState): string {
  return JSON.stringify([s.status, s.server, s.serverIp, s.build, s.gameNick, s.catalogPack, s.discordUserId])
}

/**
 * While the socket keeps this launcher in the server's presence, a beat only
 * carries a change of state; without the socket every beat goes out as before,
 * because then the beat itself is what keeps the player online and counts hours.
 */
export function presenceBeatDue(tracked: boolean, key: string, sent: string | null, sending: string | null): boolean {
  if (!tracked) return true
  return key !== sent && key !== sending
}

/** The play stats snapshot is only a cross-check, so in game it is sent this rarely. */
export const STATS_SYNC_EVERY_MS = 10 * 60_000

export function statsSyncDue(lastAt: number, now: number): boolean {
  return now - lastAt >= STATS_SYNC_EVERY_MS
}
