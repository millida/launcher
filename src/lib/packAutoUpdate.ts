import { hasTauri } from '../ipc/tauri'
import { anyGameRunning } from '../state/game'
import { installTask } from '../state/installs'
import { useProfiles } from '../state/profiles'
import { useUi } from '../state/ui'
import { keyCatalogPack } from './installKeys'
import { findPackUpdate, runPackUpdateForLaunch } from './packLaunch'
import type { PackUpdate } from './packUpdate'

export const AUTO_UPDATE_FIRST_MS = 2 * 60 * 1000
export const AUTO_UPDATE_EVERY_MS = 30 * 60 * 1000
export const AUTO_UPDATE_PLAYED_WITHIN_MS = 14 * 24 * 60 * 60 * 1000

export interface AutoUpdateInput {
  update: PackUpdate | null
  lastPlayedAt: number | null
  now: number
  gameRunning: boolean
  launching: boolean
  busy: boolean
  failed: boolean
}

export type AutoUpdateSkip = 'current' | 'not-played' | 'game' | 'launching' | 'busy' | 'failed'

export type AutoUpdateVerdict = { kind: 'update'; update: PackUpdate } | { kind: 'skip'; reason: AutoUpdateSkip }

/**
 * A download of a whole pack is gigabytes, so the background only brings
 * builds the player actually plays, never while a game is running (it would
 * take the bandwidth from the game) and never over a launch, which updates the
 * build itself. A version that already failed here waits for Play, which shows
 * the reason, instead of being downloaded again every half hour.
 */
export function autoUpdateVerdict(i: AutoUpdateInput): AutoUpdateVerdict {
  if (!i.update) return { kind: 'skip', reason: 'current' }
  if (i.lastPlayedAt === null || i.now - i.lastPlayedAt > AUTO_UPDATE_PLAYED_WITHIN_MS) return { kind: 'skip', reason: 'not-played' }
  if (i.gameRunning) return { kind: 'skip', reason: 'game' }
  if (i.launching) return { kind: 'skip', reason: 'launching' }
  if (i.busy) return { kind: 'skip', reason: 'busy' }
  if (i.failed) return { kind: 'skip', reason: 'failed' }
  return { kind: 'update', update: i.update }
}

export const autoUpdateAttempt = (profile: string, u: PackUpdate): string => profile + '@' + u.to

function lastPlayedAt(profile: string): number | null {
  try {
    const at = Number(localStorage.getItem('m-last-' + profile))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

async function updateOf(profile: string): Promise<PackUpdate | null> {
  try {
    return await findPackUpdate(profile)
  } catch {
    return null
  }
}

/**
 * Brings installed catalogue builds to their published version while the
 * launcher sits idle, through the same job Play runs, so a press of Play right
 * after a release finds the build ready or follows the download already under
 * way. The switch itself keeps the installed version until the next one is
 * whole.
 */
export function initPackAutoUpdate(): () => void {
  if (!hasTauri()) return () => {}
  const failed = new Set<string>()
  let running = false
  let stopped = false

  const pass = async () => {
    if (running || stopped) return
    running = true
    try {
      for (const p of [...useProfiles.getState().profiles]) {
        if (stopped) return
        const update = await updateOf(p.name)
        const verdict = autoUpdateVerdict({
          update,
          lastPlayedAt: lastPlayedAt(p.name),
          now: Date.now(),
          gameRunning: anyGameRunning(),
          launching: useUi.getState().prelaunch.open,
          busy: !!update && installTask(keyCatalogPack(update.slug))?.state === 'run',
          failed: !!update && failed.has(autoUpdateAttempt(p.name, update)),
        })
        if (verdict.kind !== 'update') continue
        const outcome = await runPackUpdateForLaunch(p.name, verdict.update, () => {}).outcome
        if (outcome.kind !== 'done') failed.add(autoUpdateAttempt(p.name, verdict.update))
      }
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => void pass(), AUTO_UPDATE_FIRST_MS)
  const every = setInterval(() => void pass(), AUTO_UPDATE_EVERY_MS)
  return () => {
    stopped = true
    clearTimeout(first)
    clearInterval(every)
  }
}
