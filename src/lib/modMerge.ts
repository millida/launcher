export interface MergeableHit {
  title: string
  slug?: string
  dl: number
}

// Loader and edition words the same project carries on one site and not the
// other: "Sodium" on Modrinth is "Sodium (Fabric)" on CurseForge, "Jade" is
// "Jade 🔍". Without stripping them the two entries looked like two mods.
const NOISE = /\b(fabric|forge|neoforge|quilt|rift|edition|mod|port|unofficial|official|for)\b/g

// Rendered as one project by both catalogues; the marker sits in the title.
const BRACKETS = /[([{][^)\]}]*[)\]}]/g

export function modKey(hit: MergeableHit): string {
  const fromTitle = (hit.title || '')
    .toLowerCase()
    .replace(BRACKETS, ' ')
    .replace(NOISE, ' ')
    .replace(/[^a-zа-я0-9]+/gi, '')
  return fromTitle || (hit.slug || '').toLowerCase()
}

/**
 * Cross-source duplicates collapse to the Modrinth entry: only it carries a
 * project_id, which install/dependency/update tracking relies on.
 *
 * `shown` is what the list already holds. Without it every "show more" page
 * deduplicated against its own 20 Modrinth rows only, so a mod found on page 1
 * of Modrinth came back as its CurseForge twin on page 2 — which is exactly
 * what the catalogue looked like with the source set to "all".
 */
export function mergeSources<T extends MergeableHit>(mr: T[], cf: T[], shown: Iterable<T> = []): T[] {
  const seen = new Set<string>()
  for (const hit of shown) seen.add(modKey(hit))
  const out: T[] = []
  for (const hit of mr.concat(cf)) {
    const key = modKey(hit)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out.sort((a, b) => (b.dl || 0) - (a.dl || 0))
}
