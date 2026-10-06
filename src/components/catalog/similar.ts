import { MODRINTH_API } from '../../lib/api'
import { cachedCatalog } from '../../lib/catalogCache'
import { loadMr, mrToHit, type ModHit } from '../../state/mods'
import { cardFromMrHit } from './mrTail'
import type { SiteCard, SiteSlug } from './site'

/*
 * «Похожие» на странице материала (06.10.2026). Сайт отдаёт просто топ раздела за
 * неделю — одинаковый у всех модов (к рюкзакам — JEI и голосовой чат). Здесь —
 * по смыслу: категории самого проекта на Modrinth (там они чистые), поиск того же
 * типа с теми же темами и загрузчиком, выше — у кого общих тем больше, потом по
 * скачиваниям. Библиотеки не советуем: их ставят как зависимости, искать их незачем.
 */

/** Не темы, а загрузчики и платформы — по ним «похожесть» не ищем. */
const NOT_THEME = new Set([
  'fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'rift', 'babric', 'bta-babric', 'legacy-fabric', 'ornithe', 'nilloader',
  'java-agent', 'modloader', 'bukkit', 'spigot', 'paper', 'purpur', 'folia', 'sponge', 'bungeecord', 'velocity', 'waterfall',
  'datapack', 'iris', 'optifine', 'canvas', 'vanilla', 'minecraft', 'library',
])
const MOD_LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt'])

interface MrProject {
  id: string
  project_type: string
  categories?: string[]
  additional_categories?: string[]
  loaders?: string[]
}

interface MrSearchHit {
  project_id: string
  categories?: string[]
  downloads: number
}

const isLibrary = (cats: string[] | undefined) => !!cats && cats.includes('library')

export async function similarFor(hit: ModHit, section: SiteSlug, limit = 6): Promise<SiteCard[]> {
  const id = hit.pid || hit.slug
  if (!id) return []
  const p = await cachedCatalog('mrp:' + id, async () => {
    const r = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(id))
    if (!r.ok) throw new Error('Modrinth project answered ' + r.status)
    return (await r.json()) as MrProject
  })
  const all = [...(p.categories || []), ...(p.additional_categories || [])]
  const themes = [...new Set(all.filter((c) => !NOT_THEME.has(c)))]
  if (!themes.length) return []
  const loaders = (p.loaders || []).filter((l) => MOD_LOADERS.has(l))
  const facets: string[][] = [['project_type:' + p.project_type], themes.map((c) => 'categories:' + c)]
  if (p.project_type === 'mod' && loaders.length) facets.push(loaders.map((l) => 'categories:' + l))
  const data = await loadMr(MODRINTH_API + '/v2/search?limit=40&index=downloads&facets=' + encodeURIComponent(JSON.stringify(facets)))
  const hits = (Array.isArray(data?.hits) ? data.hits : []) as MrSearchHit[]
  const self = isLibrary(p.categories)
  const shared = (h: MrSearchHit) => (h.categories || []).filter((c) => themes.includes(c)).length
  return hits
    .filter((h) => h.project_id !== p.id && (self || !isLibrary(h.categories)))
    .map((h, i) => ({ h, i, n: shared(h) }))
    // Больше общих тем — выше; при равенстве — порядок Modrinth (скачивания).
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, limit)
    .map(({ h }) => cardFromMrHit(mrToHit(h), section))
    .filter((c): c is SiteCard => !!c)
}

/** Библиотека по карточке сайта: категория, «API/Lib» в названии, «library» в описании. */
export function looksLikeLibrary(c: Pick<SiteCard, 'title' | 'summary' | 'categories'>): boolean {
  if (c.categories.some((x) => /библиотек|^library$/i.test(x))) return true
  if (/\b(api|library)\b|lib\b/i.test(c.title)) return true
  return /^(a |an |the )?(library|api)\b|\blibrary (mod|for)\b|библиотек/i.test((c.summary || '').trim())
}

/**
 * «Рекомендуемые» модов без поиска: библиотеки (Placebo, Fabric API, FTB Library…) —
 * в конец загруженного. Сайт ставит их наверх из-за сотен миллионов скачиваний
 * зависимостями, а игрок их не ищет — они ставятся сами. Порядок остальных не меняется.
 */
export function librariesLast(cards: SiteCard[]): SiteCard[] {
  const libs: SiteCard[] = []
  const rest: SiteCard[] = []
  for (const c of cards) (looksLikeLibrary(c) ? libs : rest).push(c)
  return libs.length ? [...rest, ...libs] : cards
}
