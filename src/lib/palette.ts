export type PaletteKind = 'screen' | 'settings' | 'build' | 'server' | 'friend'

export interface PaletteItem {
  id: string
  kind: PaletteKind
  title: string
  /** Extra words the item is found by, besides its title. */
  words?: string
  run: () => void
}

const KIND_ORDER: Record<PaletteKind, number> = { build: 0, screen: 1, friend: 2, server: 3, settings: 4 }

const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е').trim()

/// Title prefix beats a word prefix beats a substring; every typed word must be found.
export function scoreItem(item: Pick<PaletteItem, 'title' | 'words'>, query: string): number {
  const q = norm(query)
  if (!q) return 1
  const title = norm(item.title)
  const all = title + ' ' + norm(item.words || '')
  const parts = q.split(/\s+/).filter(Boolean)
  if (!parts.every((p) => all.includes(p))) return 0
  if (title.startsWith(q)) return 100
  if (title.split(/[\s«»"'.,:-]+/).some((w) => w.startsWith(parts[0]))) return 60
  if (title.includes(q)) return 40
  return 20
}

export function rankItems<T extends PaletteItem>(items: T[], query: string, limit = 12): T[] {
  return items
    .map((item, i) => ({ item, i, score: scoreItem(item, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}

/// Ctrl+K on Windows and Linux, Cmd+K on macOS; never while typing in a field of its own.
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  const k = e.code === 'KeyK' || e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'л'
  return k && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
}
