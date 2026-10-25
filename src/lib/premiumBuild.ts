import { useEffect, useState } from 'react'
import { loadProfileSettings } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { loadPackView } from '../components/premium/packView'
import type { PackView } from '../components/premium/packView'
import { ARCANIA_POSTER } from '../components/arcania/content'
import { isArcania2, useArcania2Live } from './arcaniaRelease'
import { catalogPackSlug } from './packUpdate'

export interface PremiumBuild {
  slug: string
  cover: string | null
}

export function premiumBuildOf(
  slug: string | null,
  view: Pick<PackView, 'cover' | 'accessRequired'> | null | undefined,
  arcania2: boolean,
): PremiumBuild | null {
  if (!slug || !view || view.accessRequired !== true) return null
  return { slug, cover: isArcania2(slug, arcania2) ? ARCANIA_POSTER : view.cover || null }
}

interface Found {
  profile: string
  slug: string | null
  view: PackView | null
}

export function usePremiumBuild(profile: string | null, on: boolean): PremiumBuild | null {
  const [found, setFound] = useState<Found | null>(null)
  const arcania2 = useArcania2Live()

  useEffect(() => {
    if (!on || !profile || !hasTauri()) return
    let alive = true
    loadProfileSettings(profile)
      .then(async (settings) => {
        const slug = catalogPackSlug(settings)
        return { profile, slug, view: slug ? await loadPackView(slug) : null }
      })
      // An unreadable card leaves the build in its own look; the next visit asks again.
      .catch(() => ({ profile, slug: null, view: null }))
      .then((next) => {
        if (alive) setFound(next)
      })
    return () => {
      alive = false
    }
  }, [profile, on])

  return found && found.profile === profile ? premiumBuildOf(found.slug, found.view, arcania2) : null
}
