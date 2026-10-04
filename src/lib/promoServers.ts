import { addServer, pinServerDat } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { isGameRunning } from '../state/game'
import { useProfiles } from '../state/profiles'
import { usePromo, type ListedServer } from '../state/promo'

const APPLIED_KEY = 'm-promo-servers'

const RELEASE = /^\d+(?:\.\d+){1,2}$/

/** Snapshots and custom names never match: a server we cannot promise to let in is not added. */
export function versionAtLeast(version: string, min: string): boolean {
  if (!RELEASE.test(version)) return false
  const a = version.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d > 0
  }
  return true
}

export const appliedKey = (profile: string, addr: string): string => profile + '\n' + addr

/**
 * Which builds still lack which listed server. A pair is applied once: a player
 * who deletes the entry keeps it deleted. A running build is left for the next
 * pass because the game rewrites servers.dat when it leaves the server screen.
 */
export function pendingAdds(
  profiles: readonly { name: string; version: string }[],
  list: readonly ListedServer[],
  applied: ReadonlySet<string>,
  running: (profile: string) => boolean,
): Array<{ profile: string; server: ListedServer }> {
  const out: Array<{ profile: string; server: ListedServer }> = []
  for (const p of profiles) {
    if (running(p.name)) continue
    for (const server of list) {
      if (applied.has(appliedKey(p.name, server.addr))) continue
      if (server.minVersion && !versionAtLeast(p.version, server.minVersion)) continue
      out.push({ profile: p.name, server })
    }
  }
  return out
}

function readApplied(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(APPLIED_KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeApplied(applied: Set<string>): void {
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify([...applied]))
  } catch (e) {
    console.warn('[promo-servers] save', e)
  }
}

let running: Promise<void> | null = null
let again = false

async function apply(): Promise<void> {
  const list = usePromo.getState().promo.serverList
  if (!list.length) return
  const applied = readApplied()
  for (const { profile, server } of pendingAdds(useProfiles.getState().profiles, list, applied, isGameRunning)) {
    try {
      await addServer(profile, server.name, server.addr)
      await pinServerDat(profile, server.name, server.addr)
      applied.add(appliedKey(profile, server.addr))
      writeApplied(applied)
    } catch (e) {
      console.warn('[promo-servers] ' + profile, e)
    }
  }
}

function schedule(): void {
  if (running) {
    again = true
    return
  }
  running = apply().finally(() => {
    running = null
    if (again) {
      again = false
      schedule()
    }
  })
}

/** Adds the servers the API lists to every build, now and whenever the list or the builds change. */
export function watchPromoServers(): () => void {
  if (!hasTauri()) return () => {}
  schedule()
  const offPromo = usePromo.subscribe((s, prev) => s.promo.serverList !== prev.promo.serverList && schedule())
  const offProfiles = useProfiles.subscribe((s, prev) => s.profiles !== prev.profiles && schedule())
  return () => {
    offPromo()
    offProfiles()
  }
}
