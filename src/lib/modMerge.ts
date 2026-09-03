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

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
}

function relevance(hit: MergeableHit, ts: string[], phrase: string): number {
  const title = (hit.title || '').toLowerCase()
  let score = 0
  for (const t of ts) if (title.includes(t)) score += 1
  if (title.includes(phrase)) score += ts.length
  return score
}

/**
 * Cross-source duplicates collapse to the Modrinth entry: only it carries a
 * project_id, which install/dependency/update tracking relies on.
 *
 * `shown` is what the list already holds. Without it every "show more" page
 * deduplicated against its own 20 Modrinth rows only, so a mod found on page 1
 * of Modrinth came back as its CurseForge twin on page 2 — which is exactly
 * what the catalogue looked like with the source set to "all".
 *
 * `query` switches the order from downloads to how well the title answers it:
 * sorting a search by downloads buried «Vanilla Like Experience» (265 downloads)
 * under RLCraft and ATM10, and the catalogue looked like it ignored the query.
 */
export function mergeSources<T extends MergeableHit>(
  mr: T[],
  cf: T[],
  shown: Iterable<T> = [],
  query = '',
): T[] {
  const seen = new Set<string>()
  for (const hit of shown) seen.add(modKey(hit))
  const out: T[] = []
  for (const hit of mr.concat(cf)) {
    const key = modKey(hit)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  const ts = terms(query)
  if (!ts.length) return out.sort((a, b) => (b.dl || 0) - (a.dl || 0))
  const phrase = query.trim().toLowerCase()
  // Stable sort keeps the source order inside one score: Modrinth already
  // answers a query by relevance, CurseForge by popularity.
  return out.sort((a, b) => relevance(b, ts, phrase) - relevance(a, ts, phrase))
}
