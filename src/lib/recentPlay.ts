/// Worlds and servers the player entered through Quick Play, newest first: the
/// arrow next to «Играть» takes them back in one click.
export interface RecentPlay {
  profile: string
  world: string | null
  server: string | null
  name: string
  at: number
}

const KEY = 'm-recent-play'
const KEEP = 20

function read(): RecentPlay[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list.filter((r) => r && typeof r.profile === 'string' && (r.world || r.server)) : []
  } catch {
    return []
  }
}

const sameTarget = (a: RecentPlay, b: Pick<RecentPlay, 'profile' | 'world' | 'server'>) =>
  a.profile === b.profile && a.world === b.world && a.server === b.server

export function rememberPlay(profile: string, world: string | null, server: string | null, name?: string | null): void {
  if (!world && !server) return
  const entry: RecentPlay = { profile, world, server, name: name || world || server || '', at: Date.now() }
  const next = [entry, ...read().filter((r) => !sameTarget(r, entry))].slice(0, KEEP)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch (e) {
    console.warn('[recent-play] not saved', e)
  }
}

/// Only targets whose build still exists: a deleted build cannot take anyone back.
export function recentPlays(builds: string[], limit = 5): RecentPlay[] {
  const have = new Set(builds)
  return read()
    .filter((r) => have.has(r.profile))
    .slice(0, limit)
}
