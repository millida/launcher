import { useEffect, useState } from 'react'
import { listLoaderVersions, type LoaderBuild, type McVersion } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

const YEAR_RELEASE = /^(\d{2})\.(\d+)(?:\.(\d+))?$/

/// Only year-numbered lines (26.3 → 26.3.1) get a patch offer: in the old 1.x
/// scheme the third number was a content drop (1.21.1 → 1.21.4) that breaks mods.
export function newerPatch(current: string, list: McVersion[]): string | null {
  const cur = YEAR_RELEASE.exec(current)
  if (!cur) return null
  let best: string | null = null
  let bestPatch = Number(cur[3] || 0)
  for (const v of list) {
    if (v.kind !== 'release') continue
    const m = YEAR_RELEASE.exec(v.id)
    if (!m || m[1] !== cur[1] || m[2] !== cur[2]) continue
    const patch = Number(m[3] || 0)
    if (patch > bestPatch) {
      bestPatch = patch
      best = v.id
    }
  }
  return best
}

const buildNums = (v: string): number[] => (v.match(/\d+/g) || []).map(Number)

function isNewer(a: string, b: string): boolean {
  const x = buildNums(a)
  const y = buildNums(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  }
  return false
}

/// An unpinned build already takes the recommended loader on every install,
/// so only a pinned one can fall behind.
export function newerLoaderBuild(pinned: string | null | undefined, builds: LoaderBuild[]): string | null {
  if (!pinned) return null
  const target = builds.find((b) => b.recommended) || builds.find((b) => b.stable)
  if (!target || !isNewer(target.version, pinned)) return null
  return target.version
}

/// Forge and NeoForge builds are cut per game version, so a pin cannot follow
/// the game to a patch; Fabric and Quilt loaders do not depend on it.
export const loaderPinFollowsGame = (loader: string): boolean => loader === 'fabric' || loader === 'quilt'

export interface CoreUpdate {
  mc: string | null
  loader: string | null
}

const NONE: CoreUpdate = { mc: null, loader: null }

const buildsOf = (loader: string, version: string): Promise<LoaderBuild[]> =>
  listLoaderVersions(loader, version).then(
    (b) => (Array.isArray(b) ? b : []),
    () => [],
  )

export function useCoreUpdate(
  version: string,
  loader: string,
  loaderVersion: string | null | undefined,
  list: McVersion[],
  active: boolean,
): CoreUpdate {
  const [found, setFound] = useState<CoreUpdate>(NONE)
  useEffect(() => {
    setFound(NONE)
    if (!active || !version || !hasTauri()) return
    let alive = true
    const patch = newerPatch(version, list)
    const vanilla = loader === 'vanilla'
    // A patch the loader has no build for yet would leave the build unlaunchable.
    const mc: Promise<string | null> =
      !patch || vanilla ? Promise.resolve(patch) : buildsOf(loader, patch).then((b) => (b.length ? patch : null))
    const lv: Promise<string | null> =
      vanilla || !loaderVersion
        ? Promise.resolve(null)
        : buildsOf(loader, version).then((b) => newerLoaderBuild(loaderVersion, b))
    void Promise.all([mc, lv]).then(([m, l]) => {
      if (alive) setFound({ mc: m, loader: l })
    })
    return () => {
      alive = false
    }
  }, [version, loader, loaderVersion, list, active])
  return found
}
