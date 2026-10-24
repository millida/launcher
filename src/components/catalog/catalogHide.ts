import { create } from 'zustand'
import type { SiteCard } from './site'
import { millidaPid } from './millidaInstall'

const KEY = 'm-catalog-hide'

interface Saved {
  installed: boolean
  excluded: string[]
}

function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Saved>
    return {
      installed: raw.installed === true,
      excluded: Array.isArray(raw.excluded) ? raw.excluded.filter((x): x is string => typeof x === 'string').slice(0, 40) : [],
    }
  } catch {
    return { installed: false, excluded: [] }
  }
}

function write(v: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* the choice lives for this session only */
  }
}

interface HideState extends Saved {
  setInstalled: (on: boolean) => void
  toggleExcluded: (category: string) => void
}

export const useCatalogHide = create<HideState>((set, get) => ({
  ...read(),
  setInstalled: (on) => {
    set({ installed: on })
    write({ installed: on, excluded: get().excluded })
  },
  toggleExcluded: (category) => {
    const cur = get().excluded
    const excluded = cur.includes(category) ? cur.filter((c) => c !== category) : [...cur, category]
    set({ excluded })
    write({ installed: get().installed, excluded })
  },
}))

/** Every id a build may record this card under: our catalogue, Modrinth or CurseForge. */
export function cardPids(card: Pick<SiteCard, 'slug' | 'mrHit' | 'curseforgeId'>): string[] {
  const out = [millidaPid(card.slug)]
  if (card.mrHit?.pid) out.push(card.mrHit.pid)
  if (card.curseforgeId) out.push('cf:' + card.curseforgeId)
  return out
}

export function keepCard(card: Pick<SiteCard, 'slug' | 'mrHit' | 'curseforgeId' | 'categories'>, installed: ReadonlySet<string> | null, excluded: readonly string[]): boolean {
  if (installed && cardPids(card).some((p) => installed.has(p))) return false
  return !excluded.length || !(card.categories || []).some((c) => excluded.includes(c))
}
