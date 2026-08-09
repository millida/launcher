import { useEffect, useMemo, useState } from 'react'
import { listLoaderVersions, type LoaderBuild } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import type { SelectOption } from '../components/Select'

/// Empty means "let the installer pick the recommended build".
export const AUTO_LOADER_VERSION = ''

export const hasLoaderVersions = (loader: string): boolean => loader !== 'vanilla'

export function useLoaderBuilds(loader: string, mcVersion: string, active: boolean) {
  const [builds, setBuilds] = useState<LoaderBuild[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setBuilds([])
    setError('')
    if (!active || !hasLoaderVersions(loader) || !mcVersion || !hasTauri()) {
      setLoading(false)
      return
    }
    // A slow list for an older pick must not overwrite the current one.
    let alive = true
    setLoading(true)
    listLoaderVersions(loader, mcVersion)
      .then((b) => {
        if (!alive) return
        setBuilds(b)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(String(e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [loader, mcVersion, active])

  const recommended = useMemo(() => builds.find((b) => b.recommended)?.version || '', [builds])

  /// `pinned` keeps a build that the list does not carry (a modpack pin, or an
  /// offline list) selectable instead of silently falling back to auto.
  const options = useMemo((): SelectOption[] => {
    const auto: SelectOption = {
      value: AUTO_LOADER_VERSION,
      label: 'Рекомендуемая',
      sub: recommended ? recommended : undefined,
    }
    return [
      auto,
      ...builds.map((b) => ({
        value: b.version,
        label: b.version,
        sub: b.recommended ? 'рекомендуемая' : b.stable ? undefined : 'нестабильная',
      })),
    ]
  }, [builds, recommended])

  const withPinned = (pinned?: string | null): SelectOption[] =>
    pinned && !options.some((o) => o.value === pinned)
      ? [options[0], { value: pinned, label: pinned, sub: 'выбрана' }, ...options.slice(1)]
      : options

  return { builds, loading, error, recommended, options, withPinned }
}
