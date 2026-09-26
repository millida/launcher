import { realDownloads } from '../../lib/realDownloads'
import { api, openExt } from '../../lib/api'
import { cachedCatalog, peekCatalog } from '../../lib/catalogCache'
import { MODRINTH_API } from '../../lib/api'
import { hasTauri } from '../../ipc/tauri'
import { millidaPacks } from '../../ipc/commands'
import type { MillidaPack } from '../../ipc/commands'
import type { ModHit } from '../../state/mods'

/*
 * Каталог Millida в лаунчере = каталог millida.net (приказ владельца
 * 24.09.2026, 15:25: «всё просто возьми из каталога Millida»).
 *
 * Данные — ровно те же адреса, что рисуют сайт: `/v2/catalog/listing`,
 * `/v2/catalog/facets`, `/v2/catalog/sections` (соседи `/catalog/packs`,
 * который лаунчер уже читал). Поэтому разделы, счётчики, русские описания,
 * версии, загрузчики и категории совпадают с сайтом до цифры.
 *
 * Разделы, названия, заголовки, порядок и оформление меток перенесены из
 * сайта: `src/lib/catalog-sections.ts`, `catalog-type-tabs.ts`,
 * `catalog-visuals.ts`, `components/catalog/mr/*`. Серверное (плагины,
 * серверные сборки) живёт в «Хостинге», а не здесь — как и раньше.
 */

export type SiteSlug = 'mods' | 'modpacks' | 'texture-packs' | 'shaders' | 'data-packs' | 'maps' | 'plugins' | 'server-packs'

export interface SiteSection {
  slug: SiteSlug
  /** Вид материала для установки лаунчером — как `useMods.modTab`. */
  kind: 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'datapack' | 'world' | 'plugin' | 'serverpack'
  title: string
  h1: string
  /** Есть ось «Загрузчик» (у ресурс-паков, дата-паков и карт её нет). */
  loaderAxis: boolean
  /** Лента карточками с обложкой — как на сайте у шейдеров и ресурс-паков. */
  gallery: boolean
}

/** Порядок — как во вкладках каталога сайта (`CATALOG_TYPE_TABS`). */
export const SITE_SECTIONS: SiteSection[] = [
  { slug: 'mods', kind: 'mod', title: 'Моды', h1: 'Моды для Minecraft', loaderAxis: true, gallery: false },
  { slug: 'modpacks', kind: 'modpack', title: 'Сборки', h1: 'Сборки модов для Minecraft', loaderAxis: true, gallery: false },
  { slug: 'texture-packs', kind: 'resourcepack', title: 'Ресурс-паки', h1: 'Ресурс-паки и текстуры для Minecraft', loaderAxis: false, gallery: true },
  { slug: 'shaders', kind: 'shader', title: 'Шейдеры', h1: 'Шейдеры для Minecraft', loaderAxis: true, gallery: true },
  { slug: 'data-packs', kind: 'datapack', title: 'Дата-паки', h1: 'Дата-паки для Minecraft', loaderAxis: false, gallery: false },
  { slug: 'maps', kind: 'world', title: 'Карты', h1: 'Карты для Minecraft', loaderAxis: false, gallery: false },
]

/*
 * Тот же каталог для сервера (приказ владельца 24.09.2026, 18:35: «каталог
 * один, кнопку добавили — она везде»): вкладка контента панели хостинга
 * рисует `SiteCatalog target="server"`. Разделы — то, что сервер умеет
 * принять: сборки, серверные сборки, плагины, моды, дата-паки, карты. Ресурс-
 * паки и шейдеры — клиентские, серверу не нужны.
 */
const SERVER_ONLY: SiteSection[] = [
  { slug: 'server-packs', kind: 'serverpack', title: 'Серверные сборки', h1: 'Серверные сборки для Minecraft', loaderAxis: true, gallery: false },
  { slug: 'plugins', kind: 'plugin', title: 'Плагины', h1: 'Плагины для сервера Minecraft', loaderAxis: true, gallery: false },
]

export const SERVER_SECTIONS: SiteSection[] = [
  SITE_SECTIONS[1]!,
  SERVER_ONLY[0]!,
  SERVER_ONLY[1]!,
  SITE_SECTIONS[0]!,
  SITE_SECTIONS[4]!,
  SITE_SECTIONS[5]!,
]

export function sectionBySlug(slug: string): SiteSection {
  return SITE_SECTIONS.find((s) => s.slug === slug) || SERVER_ONLY.find((s) => s.slug === slug) || SITE_SECTIONS[0]!
}

/**
 * Встаёт ли материал на сервер хостинга — правила сайта (`hostOnServer` в
 * `catalog-rows.tsx`) и бэкенда (`hosting-catalog-install.ts`): кнопка, за
 * которой отказ, хуже её отсутствия. Мод — только серверный или общий;
 * платные сборки лаунчера (`launcherOnly`) хостинг не ставит.
 */
export function hostable(sec: SiteSection, card: Pick<SiteCard, 'side' | 'launcherOnly' | 'premium'>): boolean {
  if (card.launcherOnly || card.premium) return false
  if (sec.kind === 'mod') return card.side === 'SERVER' || card.side === 'BOTH'
  return ['modpack', 'serverpack', 'plugin', 'datapack', 'world'].includes(sec.kind)
}

export function sectionByKind(kind: string): SiteSection {
  return SITE_SECTIONS.find((s) => s.kind === kind) || SITE_SECTIONS[0]!
}

/* ── Ответы API (типы — из `src/lib/catalog-api.ts` сайта) ── */

export interface SiteCard {
  slug: string
  section: string | null
  title: string
  summary: string
  cover: string | null
  icon: string | null
  side: string | null
  launcherOnly?: boolean
  author: string | null
  /**
   * Только НАШИ скачивания (как на сайте с 21.09.2026). Ноль или пусто — строки
   * «скачиваний» нет вовсе. `sourceDownloads` (счётчик донора) не показываем.
   */
  downloads: number | null
  sourceDownloads?: number | null
  /** Платная сборка (`/catalog/packs` → `accessRequired`): плашка «Премиум». */
  premium?: boolean
  versions: string[]
  loaders: string[]
  categories: string[]
  publishedAt: string | null
  updatedAt: string | null
  mrHit?: ModHit
}

export interface SiteListing {
  section: string
  total: number
  page: number
  perPage: number
  pages: number
  items: SiteCard[]
}

export interface Facet {
  value: string
  count: number
}

export interface SiteFacets {
  section: string
  versions: Facet[]
  loaders: Facet[]
  categories: Facet[]
}

export interface SiteSectionStat {
  section: string
  title: string
  items: number
}

export interface ListingQuery {
  section: SiteSlug
  version?: string | null
  loader?: string | null
  category?: string | null
  q?: string | null
  sort?: 'popular' | 'new'
  page?: number
  perPage?: number
}

export const PER_PAGE = 20

function qs(p: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') sp.set(k, String(v))
  return sp.toString()
}

export function loadListing(p: ListingQuery): Promise<SiteListing> {
  const path =
    '/catalog/listing?' +
    qs({
      section: p.section,
      version: p.version,
      loader: p.loader,
      category: p.category,
      q: p.q,
      sort: p.sort === 'new' ? 'new' : null,
      page: p.page && p.page > 1 ? p.page : null,
      perPage: p.perPage || PER_PAGE,
    })
  return cachedCatalog('site:' + path, () => api<SiteListing>(path))
}

export function loadFacets(section: SiteSlug, version?: string | null, loader?: string | null): Promise<SiteFacets> {
  const path = '/catalog/facets?' + qs({ section, version, loader })
  return cachedCatalog('site:' + path, () => api<SiteFacets>(path))
}

export function loadSections(): Promise<SiteSectionStat[]> {
  return cachedCatalog('site:/catalog/sections', () => api<SiteSectionStat[]>('/catalog/sections'))
}

/* ── Платные сборки (Arcania и все с accessRequired) ── */

/** Наш каталог сборок: в приложении — командой ядра, в браузере — адресом. */
export function loadPremiumPacks(): Promise<MillidaPack[]> {
  return cachedCatalog('site:premium-packs', () =>
    (hasTauri() ? millidaPacks() : api<MillidaPack[]>('/catalog/packs')).then((l) =>
      (Array.isArray(l) ? l : []).filter((p) => p && p.accessRequired),
    ),
  )
}

/** Сборка каталога в виде строки ленты — когда её нет на текущей странице выдачи. */
export function premiumCard(p: MillidaPack): SiteCard {
  return {
    slug: p.slug,
    section: 'modpacks',
    title: p.title,
    summary: p.summary,
    cover: p.cover,
    icon: null,
    side: 'CLIENT',
    launcherOnly: true,
    author: p.author || null,
    downloads: typeof p.downloads === 'number' ? p.downloads : null,
    premium: true,
    versions: p.game ? [p.game] : [],
    loaders: p.loader ? [p.loader] : [],
    categories: [],
    publishedAt: null,
    updatedAt: null,
  }
}

/** Наше число скачиваний или null — если показывать нечего. */
export const ownDownloads = (card: Pick<SiteCard, 'downloads'> & { slug?: string | null }): number | null => {
  const n = realDownloads(card.slug, card.downloads)
  return typeof n === 'number' && n > 0 ? n : null
}

/* ── Оформление (из `catalog-visuals.ts` и `num-format.ts` сайта) ── */

/** Загрузчики, у которых есть фирменный цвет (`--m-ld-*` в catalog2.css). */
const TONED = new Set([
  'forge', 'fabric', 'neoforge', 'quilt', 'legacy-fabric', 'ornithe', 'liteloader', 'paper', 'folia', 'spigot',
  'bukkit', 'purpur', 'sponge', 'velocity', 'bungeecord', 'waterfall', 'datapack', 'java-agent', 'optifine', 'iris', 'vanilla',
])
export const loaderTone = (slug: string): string | null => (TONED.has(slug) ? `var(--m-ld-${slug})` : null)

const MR_LOADERS = new Set([
  'babric', 'bta-babric', 'bukkit', 'bungeecord', 'canvas', 'datapack', 'fabric', 'folia', 'forge', 'geyser',
  'iris', 'java-agent', 'legacy-fabric', 'liteloader', 'minecraft', 'modloader', 'neoforge', 'nilloader',
  'optifine', 'ornithe', 'paper', 'purpur', 'quilt', 'rift', 'spigot', 'sponge', 'vanilla', 'velocity', 'waterfall',
])
export const loaderIconSrc = (slug: string): string | null => (MR_LOADERS.has(slug) ? `/mr-icons/loaders/${slug}.svg` : null)

const LOADER_LABEL: Record<string, string> = {
  forge: 'Forge', fabric: 'Fabric', neoforge: 'NeoForge', quilt: 'Quilt', 'legacy-fabric': 'Legacy Fabric',
  ornithe: 'Ornithe', liteloader: 'LiteLoader', paper: 'Paper', folia: 'Folia', spigot: 'Spigot', bukkit: 'Bukkit',
  purpur: 'Purpur', sponge: 'Sponge', velocity: 'Velocity', bungeecord: 'BungeeCord', waterfall: 'Waterfall',
  datapack: 'Дата-пак', 'java-agent': 'Java Agent', optifine: 'OptiFine', iris: 'Iris', minecraft: 'Ванильная игра',
  rift: 'Rift', modloader: 'ModLoader', babric: 'Babric', canvas: 'canvas', vanilla: 'vanilla',
}
export const loaderLabel = (slug: string): string => LOADER_LABEL[slug] || slug

/** Наши русские категории → значок категории Modrinth с тем же смыслом. */
export const MR_CATEGORY: Record<string, string> = {
  утилиты: 'utility', декор: 'decoration', приключения: 'adventure', библиотеки: 'library',
  'генерация мира': 'worldgen', оптимизация: 'optimization', механика: 'game-mechanics', оружие: 'equipment',
  техника: 'technology', мобы: 'mobs', управление: 'management', хранилища: 'storage', социальные: 'social',
  транспорт: 'transportation', магия: 'magic', еда: 'food', 'мини-игры': 'minigame', экономика: 'economy',
  чат: 'scroll-text', защита: 'shield', rpg: 'castle', 'для игры с друзьями': 'multiplayer',
  'для слабых пк': 'potato', 'для очень слабых пк': 'potato', 'для средних пк': 'medium', хардкор: 'challenging',
  'всего понемногу': 'kitchen-sink', 'с квестами': 'quests', ванильные: 'vanilla-like', 'мелкие правки': 'tweaks',
  интерфейс: 'gui', модели: 'models', тематические: 'themed', предметы: 'items', минимализм: 'simplistic',
  блоки: 'blocks', 'под моды': 'modded', существа: 'entities', природа: 'environment', реализм: 'realistic',
  звук: 'audio', шрифты: 'fonts', странные: 'cursed', атмосферные: 'atmosphere', тени: 'shadows', фэнтези: 'fantasy',
  полуреализм: 'semi-realistic', 'цветной свет': 'colored-lighting', отражения: 'reflections', мультяшные: 'cartoon',
  pbr: 'pbr', свечение: 'bloom', трассировка: 'path-tracing', 'для скриншотов': 'screenshot', требовательные: 'high',
  листва: 'foliage', лёгкие: 'lightweight', зима: 'tree-pine', маски: 'theater',
}
export function categoryIconSrc(value: string): string | null {
  const key = value.trim().toLowerCase()
  if (MR_CATEGORY[key]) return `/mr-icons/categories/${MR_CATEGORY[key]}.svg`
  if (/^\d+x/.test(key)) return '/mr-icons/categories/grid-3x3.svg'
  return null
}

export const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «88 тыс.», «1,3 млн» — как на сайте. */
export function fmtNum(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    const digits = m >= 100 ? 0 : 1
    return `${m.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })} млн`
  }
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString('ru-RU')} тыс.`
  return n.toLocaleString('ru-RU')
}

export const materials = (n: number): string => `${n.toLocaleString('ru-RU')} ${plural(n, 'материал', 'материала', 'материалов')}`

export function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diffMin = Math.floor((Date.now() - t) / 60000)
  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} ${plural(diffMin, 'минуту', 'минуты', 'минут')} назад`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`
  return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/** Имя без хвостов «— скачать мод на Fabric» и «для Minecraft» (`displayName` сайта). */
export function displayName(title: string): string {
  const base = title.replace(/\s*[—–-]\s*скач(?:ать|ай)(?:\s.*)?$/i, '').trim() || title
  // Хвост типа «— плагин», «- мод», «— карта» — тип и так виден по разделу.
  const noKind = base.replace(/\s*[—–-]\s*(?:плагин|мод|карта|сборка|шейдер|ресурс-?пак|дата-?пак)\s*$/i, '').trim() || base
  const cut = noKind.replace(/\s+(?:для|под)\s+(?:minecraft|майнкрафт)(?:\s+(?:pe|java|bedrock))?(?:\s+[0-9][0-9a-z.+-]*)?\s*$/i, '').trim()
  return cut || noKind
}

/** «1.16 — 26.2»: версии приходят от новой к старой. */
export function versionRange(versions: string[]): string | null {
  if (!versions.length) return null
  const newest = versions[0]!
  const oldest = versions[versions.length - 1]!
  return newest === oldest ? newest : `${oldest} — ${newest}`
}

export const SIDE_LABEL: Record<string, { label: string; icon: string }> = {
  CLIENT: { label: 'Клиент', icon: 'i-monitor' },
  SERVER: { label: 'Сервер', icon: 'i-server' },
  BOTH: { label: 'Клиент и сервер', icon: 'globe' },
}

/* ── Установка: карточка сайта → то, что умеет ставить лаунчер ── */

/** Страница материала на сайте — запасной путь, если лаунчер его не ставит. */
export const siteUrl = (section: string, slug: string): string => `https://millida.net/${section}/${slug}`

interface ItemView {
  sourceUrl: string | null
}

const MR_URL = /modrinth\.com\/(?:mod|modpack|resourcepack|shader|datapack|plugin)\/([^/?#]+)/i

function baseHit(card: SiteCard): ModHit {
  return {
    title: displayName(card.title),
    author: card.author || '',
    desc: card.summary,
    dl: ownDownloads(card) || 0,
    icon: card.icon || undefined,
    cats: card.categories.slice(0, 2),
    cover: card.cover || undefined,
    gameVers: card.versions,
    loaders: card.loaders,
  }
}

/**
 * Своя сборка каталога (MCSborki, Arcania) ставится своим путём — по адресу в
 * каталоге, с доступом и ключом. Ей не нужен поход за источником.
 */
export function ownPackHit(card: SiteCard): ModHit {
  return { ...baseHit(card), slug: card.slug, packSlug: card.slug, pid: 'millida:' + card.slug }
}

/**
 * Чужой материал сайт зеркалит с Modrinth: адрес источника лежит в карточке
 * (`/catalog/items/:slug` → `sourceUrl`). По нему строим строку, которую ставит
 * обычный путь лаунчера, а номер проекта нужен, чтобы узнать «уже установлено».
 */
export async function resolveHit(card: SiteCard): Promise<ModHit | null> {
  const key = 'site:hit:' + card.slug
  const hit = peekCatalog<ModHit | null>(key)
  if (hit !== undefined) return hit
  return cachedCatalog(key, async () => {
    const item = await api<ItemView>('/catalog/items/' + encodeURIComponent(card.slug)).catch(() => null)
    const m = item && item.sourceUrl ? MR_URL.exec(item.sourceUrl) : null
    if (!m) return null
    const mrSlug = decodeURIComponent(m[1]!)
    const proj = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(mrSlug))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    return { ...baseHit(card), slug: (proj && proj.slug) || mrSlug, pid: proj && proj.id ? String(proj.id) : undefined }
  })
}

export function peekHit(card: SiteCard): ModHit | null | undefined {
  if (card.mrHit) return card.mrHit
  if (card.launcherOnly) return ownPackHit(card)
  return peekCatalog<ModHit | null>('site:hit:' + card.slug)
}

export const openOnSite = (section: string, slug: string) => openExt(siteUrl(section, slug))
