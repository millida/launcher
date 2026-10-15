import { create } from 'zustand'
import type { SiteCard } from '../components/catalog/site'

const KEY = 'm-catalog-stars'
export const STAR_LIMIT = 300

export interface StarEntry {
  section: string
  card: SiteCard
  at: number
}

export const starKey = (section: string, slug: string): string => section + '/' + slug

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 300
const textList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function entryOf(raw: unknown): StarEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const { section, card, at } = raw as Record<string, unknown>
  if (!isText(section) || !card || typeof card !== 'object') return null
  const c = card as Record<string, unknown>
  if (!isText(c.slug) || !isText(c.title)) return null
  return {
    section,
    at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    card: {
      ...(c as unknown as SiteCard),
      section: textOrNull(c.section),
      summary: typeof c.summary === 'string' ? c.summary : '',
      cover: textOrNull(c.cover),
      icon: textOrNull(c.icon),
      side: textOrNull(c.side),
      author: textOrNull(c.author),
      downloads: typeof c.downloads === 'number' ? c.downloads : null,
      versions: textList(c.versions),
      loaders: textList(c.loaders),
      categories: textList(c.categories),
      publishedAt: textOrNull(c.publishedAt),
      updatedAt: textOrNull(c.updatedAt),
    },
  }
}

function read(): StarEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const list: StarEntry[] = []
    for (const one of raw) {
      const entry = entryOf(one)
      if (!entry) continue
      const key = starKey(entry.section, entry.card.slug)
      if (seen.has(key)) continue
      seen.add(key)
      list.push(entry)
    }
    return list.slice(0, STAR_LIMIT)
  } catch {
    return []
  }
}

function write(list: StarEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export type StarResult = 'on' | 'off' | 'full' | 'failed'

interface StarState {
  items: StarEntry[]
  toggle: (section: string, card: SiteCard) => StarResult
}

export const useCatalogStars = create<StarState>((set, get) => ({
  items: read(),
  toggle: (section, card) => {
    const key = starKey(section, card.slug)
    const items = get().items
    const had = items.some((e) => starKey(e.section, e.card.slug) === key)
    if (!had && items.length >= STAR_LIMIT) return 'full'
    const next = had ? items.filter((e) => starKey(e.section, e.card.slug) !== key) : [{ section, card, at: Date.now() }, ...items]
    if (!write(next)) return 'failed'
    set({ items: next })
    return had ? 'off' : 'on'
  },
}))

export const useStarred = (section: string, slug: string): boolean =>
  useCatalogStars((s) => s.items.some((e) => e.section === section && e.card.slug === slug))

export const reloadCatalogStars = (): void => useCatalogStars.setState({ items: read() })
