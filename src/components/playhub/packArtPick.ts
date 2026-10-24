export interface PackArt {
  cover: string | null
  icon: string | null
}

export interface PackViewArt {
  cover?: string | null
  banner?: string | null
  gallery?: unknown
  icon?: string | null
}

export interface ListingArtCard {
  title?: string | null
  cover?: string | null
  icon?: string | null
}

export const NO_ART: PackArt = { cover: null, icon: null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '')
const url = (s: unknown): string | null => (typeof s === 'string' && /^https:\/\/\S+$/.test(s) ? s : null)

/** A pack's own pictures: wide cover, then the banner, then the first gallery shot; the icon separately. */
export function artFromView(v: PackViewArt | null | undefined): PackArt {
  if (!v) return NO_ART
  const shot = Array.isArray(v.gallery) ? v.gallery.map(url).find((s): s is string => !!s) ?? null : null
  return { cover: url(v.cover) || url(v.banner) || shot, icon: url(v.icon) }
}

/** A translation draft has no pictures of its own; the catalog card of the original with the same title has. */
export function artFromOriginal(title: string, items: readonly ListingArtCard[]): PackArt {
  const key = norm(title)
  if (!key) return NO_ART
  const hit = items.find((c) => typeof c.title === 'string' && norm(c.title) === key && (url(c.cover) || url(c.icon)))
  return hit ? { cover: url(hit.cover), icon: url(hit.icon) } : NO_ART
}

export const hasArt = (a: PackArt): boolean => !!(a.cover || a.icon)
