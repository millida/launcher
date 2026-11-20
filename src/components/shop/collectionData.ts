import { api } from '../../lib/api'
import type { CosmeticItem } from '../../lib/gameProfile'

export interface ShopCollection {
  id: string
  title: string
  description: string
  items: string[]
  to: string | null
  order: number
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const iso = (v: unknown): string | null => {
  const s = str(v)
  return s && Number.isFinite(Date.parse(s)) ? s : null
}

export function readCollections(raw: unknown, now = Date.now()): ShopCollection[] {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(r.collections) ? r.collections : []
  return list
    .flatMap((c): ShopCollection[] => {
      const row = c && typeof c === 'object' ? (c as Record<string, unknown>) : {}
      const id = str(row.id)
      if (!id) return []
      const to = iso(row.to)
      if (to && Date.parse(to) <= now) return []
      return [
        {
          id,
          title: str(row.title) ?? id,
          description: str(row.description) ?? '',
          items: Array.isArray(row.items) ? row.items.filter((x): x is string => typeof x === 'string') : [],
          to,
          order: typeof row.order === 'number' ? row.order : 0,
        },
      ]
    })
    .sort((a, b) => a.order - b.order)
}

export const loadCollections = () => api<unknown>('/cosmetics/collections').then((r) => readCollections(r))

export function collectionMembers(collection: ShopCollection, catalog: CosmeticItem[]): CosmeticItem[] {
  const rank = new Map(collection.items.map((code, i) => [code, i]))
  const placeOf = (c: CosmeticItem) => rank.get(c.id) ?? rank.get(c.baseId ?? c.id)
  const seen = new Set<string>()
  return catalog
    .filter((c) => {
      const base = c.baseId ?? c.id
      if (placeOf(c) === undefined || seen.has(base)) return false
      seen.add(base)
      return true
    })
    .sort((a, b) => placeOf(a)! - placeOf(b)!)
}
