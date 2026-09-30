import { sectionByKind } from '../components/catalog/site'

/*
 * Сигналы «Рекомендуем» в лаунчере (как история каталога на сайте): какие
 * разделы каталога человек открывает и что ставит. Живут только на этом
 * компьютере; смеситель (lib/recsMix.ts) превращает их в вес разделов.
 */

export const SIGNALS_KEY = 'm-recs-signals'

export interface RecsSignals {
  v: 1
  visits: Record<string, number>
  installs: Record<string, number>
}

const empty = (): RecsSignals => ({ v: 1, visits: {}, installs: {} })

export function readSignals(): RecsSignals {
  try {
    const d = JSON.parse(localStorage.getItem(SIGNALS_KEY) || 'null') as Partial<RecsSignals> | null
    if (!d || d.v !== 1) return empty()
    const nums = (o: unknown): Record<string, number> => {
      const r: Record<string, number> = {}
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'number') r[k] = v
      return r
    }
    return { v: 1, visits: nums(d.visits), installs: nums(d.installs) }
  } catch {
    return empty()
  }
}

function bump(field: 'visits' | 'installs', section: string, w = 1) {
  if (!section || section === 'all') return
  try {
    const s = readSignals()
    s[field] = { ...s[field], [section]: (s[field][section] ?? 0) + w }
    localStorage.setItem(SIGNALS_KEY, JSON.stringify(s))
  } catch {}
}

/** Открыл раздел каталога (kind лаунчера: mod, world, shader…). */
export const noteVisitKind = (kind: string, w = 1) => bump('visits', sectionByKind(kind).slug, w)
/** Открыл материал раздела (slug сайта: mods, maps…). */
export const noteVisitSection = (section: string, w = 2) => bump('visits', section, w)
/** Поставил материал. */
export const noteInstallKind = (kind: string) => bump('installs', kind === 'modpack' ? 'modpacks' : sectionByKind(kind).slug)
