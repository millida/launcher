import type { ProfileSettings } from '../ipc/commands'
import type { PackView } from '../components/premium/packView'

export interface PackUpdate {
  slug: string
  from: string
  to: string
}

type PackSettings = Pick<ProfileSettings, 'catalogPackSlug' | 'catalogPackVersion' | 'catalogPackReviewFile'>

// Same shape the core accepts: the settings file sits on the player's disk and the slug goes into an API path.
const SLUG = /^[a-z0-9-]{1,80}$/

export function catalogPackSlug(s: PackSettings | null | undefined): string | null {
  const slug = (s?.catalogPackSlug || '').trim()
  return SLUG.test(slug) ? slug : null
}

/**
 * Any difference from the published version is offered, not only a higher
 * number: a version the catalogue stopped serving (pulled as broken) gives way
 * to the one it serves now. A reviewer's candidate install is left alone, since
 * the published version is the one it is meant to replace.
 */
export function packUpdateFor(
  s: PackSettings | null | undefined,
  view: Pick<PackView, 'slug' | 'version'> | null | undefined,
): PackUpdate | null {
  const slug = catalogPackSlug(s)
  if (!slug || !view) return null
  if ((s?.catalogPackReviewFile || '').trim()) return null
  if (view.slug && view.slug !== slug) return null
  const from = (s?.catalogPackVersion || '').trim()
  const to = (view.version || '').trim()
  if (!from || !to || from === to) return null
  return { slug, from, to }
}
