import { listVersions } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { setKnownVersions } from '../lib/mcVersion'

const CACHE = 'm-mc-releases'

function cached(): string[] {
  try {
    const raw = localStorage.getItem(CACHE)
    const list = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

// Hydrated before the first rating page is mapped: without it the launcher would
// show made-up versions once on every cold start.
setKnownVersions(cached())

let pending: Promise<void> | null = null

async function load(): Promise<void> {
  if (!hasTauri()) return
  const list = await listVersions()
  if (!Array.isArray(list) || !list.length) return
  setKnownVersions(list)
  try {
    localStorage.setItem(CACHE, JSON.stringify(list))
  } catch {}
}

/// Resolves even when Mojang is unreachable: an empty list means "judge nothing",
/// which is the same behaviour the launcher had before the list existed.
export function ensureMcVersions(): Promise<void> {
  if (!pending) pending = load().catch(() => {})
  return pending
}
