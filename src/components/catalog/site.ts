import { realDownloads } from '../../lib/realDownloads'
import { api, openExt } from '../../lib/api'
import { cachedCatalog, peekCatalog } from '../../lib/catalogCache'
import { MODRINTH_API } from '../../lib/api'
import { hasTauri } from '../../ipc/tauri'
import { millidaPacks } from '../../ipc/commands'
import type { MillidaPack } from '../../ipc/commands'
import type { ModHit } from '../../state/mods'
import { cfProjectOf } from '../../lib/millidaCatalog'
import { SECTION_SOURCE, listingQuery } from './sections'
import type { CatalogSortId, EditionFilter, PriceFilter, SectionSlug, SectionSource } from './sections'
import type { CatalogFile, Pricing } from './paid'

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

export type SiteSlug = SectionSlug

export interface SiteSection {
  slug: SiteSlug
  /**
   * Вид материала для установки лаунчером — как `useMods.modTab`. У разделов,
   * которые в сборку не ставятся, свой вид: плагины и серверные сборки — на
   * сервер, аддоны — Bedrock, скины и плащи — в гардероб.
   */
  kind:
    | 'all'
    | 'mod'
    | 'modpack'
    | 'resourcepack'
    | 'shader'
    | 'datapack'
    | 'world'
    | 'plugin'
    | 'serverpack'
    | 'addon'
    | 'cheat'
    | 'seed'
    | 'skin'
    | 'cape'
    | 'head'
  title: string
  h1: string
  /** Есть ось «Загрузчик» (у ресурс-паков, дата-паков и карт её нет). */
  loaderAxis: boolean
  /** Лента карточками с обложкой — с 29.09.2026 на сайте так все разделы, кроме скинов. */
  gallery: boolean
  source: SectionSource
}

const GALLERY_SLUGS = new Set<string>(['texture-packs', 'shaders', 'maps', 'seeds', 'capes', 'heads'])

const sec = (slug: SiteSlug, kind: SiteSection['kind'], title: string, h1: string, loaderAxis: boolean): SiteSection => ({
  slug,
  kind,
  title,
  h1,
  loaderAxis,
  // Картинкой выбирают только то, что смотрят глазами (как Modrinth: галерея по умолчанию у шейдеров и
  // ресурс-паков); сборки и моды — плотным списком (владелец 10.10.2026: «всё большое»).
  gallery: GALLERY_SLUGS.has(slug),
  source: SECTION_SOURCE[slug],
})

/** Все разделы сайта в порядке групп шапки (`CATALOG_GROUPS`). */
export const ALL_SECTIONS: SiteSection[] = [
  sec('all', 'all', 'Все', 'Всё для Minecraft', true),
  sec('modpacks', 'modpack', 'Сборки модов', 'Сборки модов для Minecraft', true),
  sec('server-packs', 'serverpack', 'Серверные сборки', 'Серверные сборки для Minecraft', true),
  sec('mods', 'mod', 'Моды', 'Моды для Minecraft', true),
  sec('plugins', 'plugin', 'Плагины', 'Плагины для сервера Minecraft', true),
  sec('data-packs', 'datapack', 'Дата-паки', 'Дата-паки для Minecraft', false),
  sec('addons', 'addon', 'Аддоны', 'Аддоны для Minecraft Bedrock', false),
  sec('cheats', 'cheat', 'Читы', 'Читы для Minecraft', true),
  sec('texture-packs', 'resourcepack', 'Ресурс-паки', 'Ресурс-паки и текстуры для Minecraft', false),
  sec('shaders', 'shader', 'Шейдеры', 'Шейдеры для Minecraft', true),
  sec('maps', 'world', 'Карты', 'Карты для Minecraft', false),
  sec('seeds', 'seed', 'Сиды', 'Сиды для Minecraft', false),
  sec('skins', 'skin', 'Скины', 'Скины для Minecraft', false),
  sec('capes', 'cape', 'Плащи', 'Плащи для Minecraft', false),
  sec('heads', 'head', 'Головы', 'Головы для Minecraft', false),
]

const bySlug = (slug: SiteSlug): SiteSection => ALL_SECTIONS.find((s) => s.slug === slug)!

/**
 * Шесть разделов того, что ставится в свою сборку, — плитки «Категорий» и
 * вход снаружи по `useMods.modTab`.
 */
export const SITE_SECTIONS: SiteSection[] = (['mods', 'modpacks', 'texture-packs', 'shaders', 'data-packs', 'maps'] as SiteSlug[]).map(bySlug)

/*
 * Тот же каталог для сервера (приказ владельца 24.09.2026, 18:35: «каталог
 * один, кнопку добавили — она везде»): вкладка контента панели хостинга
 * рисует `SiteCatalog target="server"`. Разделы — то, что сервер умеет
 * принять: сборки, серверные сборки, плагины, моды, дата-паки, карты. Ресурс-
 * паки и шейдеры — клиентские, серверу не нужны.
 */
export const SERVER_SECTIONS: SiteSection[] = (['modpacks', 'server-packs', 'plugins', 'mods', 'data-packs', 'maps'] as SiteSlug[]).map(bySlug)

export function sectionBySlug(slug: string): SiteSection {
  return ALL_SECTIONS.find((s) => s.slug === slug) || bySlug('mods')
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
  // Любой раздел шапки, не только шесть «своих» (плитки «Категорий» хаба, 30.09.2026).
  return SITE_SECTIONS.find((s) => s.kind === kind) || ALL_SECTIONS.find((s) => s.kind === kind && s.slug !== 'all') || SITE_SECTIONS[0]!
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
  partner?: { slug: string; name: string } | null
  versions: string[]
  loaders: string[]
  categories: string[]
  publishedAt: string | null
  updatedAt: string | null
  /** Платность материала (`CatalogCard.pricing` сайта). Нет поля — бесплатно. */
  pricing?: Pricing
  priceKopecks?: number | null
  mrHit?: ModHit
  /** Source of the card when the listing carries it; absent on an older backend. */
  sourceUrl?: string | null
  curseforgeId?: number | null
  /** Издание игры; нет поля — Java. */
  edition?: 'JAVA' | 'BEDROCK' | 'BOTH'
  /** Сборку собрала Милли (ИИ-сборщик): метка «Милли» на карточке. */
  aiGenerated?: boolean
  /** Код сборки лаунчера — установка идёт путём «Сборки по коду». */
  packCode?: string | null
}

/**
 * Когда материал на самом деле обновлялся. `updatedAt` карточек сайта — время
 * синхронизации каталога (у всех «3 часа назад», жалоба владельца 06.10.2026), поэтому
 * верим только дате выхода файла; у Modrinth `updatedAt` — настоящая дата автора.
 */
export function realUpdated(card: Pick<SiteCard, 'updatedAt' | 'mrHit'>, files?: { releasedAt?: string | null; date?: string | null }[]): string | null {
  const dates = (files || []).map((f) => f.releasedAt || f.date || '').filter((d) => Number.isFinite(Date.parse(d)))
  if (dates.length) return dates.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b))
  return card.mrHit ? card.updatedAt : null
}

export interface SiteListing {
  section: string
  /** Какие сортировки знает сервер (новый бэкенд); нет поля — только базовые три. */
  sorts?: string[]
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
  /** Счётчики по изданию (`java` / `bedrock`); старый бэкенд поле не отдаёт. */
  editions?: Facet[]
  /** «Для чего» (`?use=`) — задачи раздела; у сайта это карты и сборки. */
  uses?: { value: string; label: string; count: number }[]
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
  sort?: CatalogSortId
  page?: number
  perPage?: number
  edition?: EditionFilter | null
  use?: string | null
  price?: PriceFilter | null
}

export const PER_PAGE = 20

function qs(p: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== null && v !== undefined && v !== '') sp.set(k, String(v))
  return sp.toString()
}

/** Ключ кэша выдачи — по нему же берётся сохранённая на диске копия (staleCatalog). */
export const listingKey = (p: ListingQuery): string => 'site:/catalog/listing?' + listingQuery(p.section, { ...p, perPage: p.perPage || PER_PAGE })

export function loadListing(p: ListingQuery): Promise<SiteListing> {
  const key = listingKey(p)
  // На диск — только первые страницы: их показываем сразу при входе, остальное догружается.
  return cachedCatalog(key, () => api<SiteListing>(key.slice(5)), { persist: !p.page || p.page <= 1 })
}

export const facetsKey = (section: SiteSlug, version?: string | null, loader?: string | null, edition?: EditionFilter | null): string =>
  'site:/catalog/facets?' + qs({ section, edition, version, loader })

export function loadFacets(section: SiteSlug, version?: string | null, loader?: string | null, edition?: EditionFilter | null): Promise<SiteFacets> {
  const key = facetsKey(section, version, loader, edition)
  return cachedCatalog(key, () => api<SiteFacets>(key.slice(5)), { persist: true })
}

/** Читы и другое кураторское: файлы на нашем хранилище, `/catalog/curated/<раздел>`. */
export interface CuratedItem {
  slug: string
  downloads: number
  files: { id: string; version: string; fileName: string; size: number; gameVersions: string[]; loaders: string[]; releasedAt: string | null }[]
}
export function loadCurated(section: 'cheats'): Promise<CuratedItem[]> {
  return cachedCatalog('site:curated:' + section, () =>
    api<{ items?: CuratedItem[] }>('/catalog/curated/' + section).then((d) => (Array.isArray(d.items) ? d.items : [])),
  )
}

/** Скин сетки каталога (`/v2/skins`, `SkinCard` сайта). */
export interface SkinTile {
  id: string
  model: 'classic' | 'slim'
  title: string
  wearers: number
  renderUrl: string
  /** Текстура 64×64 — для фигуры в 3D на странице скина. */
  textureUrl?: string
  tags?: { slug: string; label: string }[]
}
export interface SkinPage {
  items: SkinTile[]
  total: number
  page: number
  pages: number
}
export function loadSkins(p: { q?: string | null; sort?: 'popular' | 'new'; page?: number; tag?: string | null }): Promise<SkinPage> {
  const path = '/skins?' + qs({ q: p.q && p.q.trim().length >= 2 ? p.q.trim() : null, tag: p.tag || null, sort: p.sort === 'new' ? 'new' : null, page: p.page && p.page > 1 ? p.page : null, limit: 24 })
  return cachedCatalog(
    'site:' + path,
    () =>
      api<{ items?: SkinTile[]; total?: number; page?: number; pages?: number }>(path).then((d) => ({
        items: (Array.isArray(d.items) ? d.items : []).filter((x) => x && /^[0-9a-fu]{16}$/.test(String(x.id))),
        total: Number(d.total) || 0,
        page: Number(d.page) || 1,
        pages: Number(d.pages) || 0,
      })),
    { persist: !p.page || p.page <= 1 },
  )
}

/** Метки скинов (`/skins/tags`): «для девочек», «аниме», «в худи»… */
export function loadSkinTags(): Promise<{ slug: string; label: string }[]> {
  return cachedCatalog(
    'site:/skins/tags',
    () => api<{ slug: string; label: string }[]>('/skins/tags').then((l) => (Array.isArray(l) ? l.filter((t) => t && t.slug && t.label) : [])),
    { persist: true },
  )
}

export function loadSections(): Promise<SiteSectionStat[]> {
  return cachedCatalog('site:/catalog/sections', () => api<SiteSectionStat[]>('/catalog/sections'), { persist: true })
}

/* ── Платные сборки (Arcania и все с accessRequired) ── */

/** Наш каталог сборок: в приложении — командой ядра, в браузере — адресом. */
export const PREMIUM_KEY = 'site:premium-packs'

export function loadPremiumPacks(): Promise<MillidaPack[]> {
  return cachedCatalog(
    PREMIUM_KEY,
    () => (hasTauri() ? millidaPacks() : api<MillidaPack[]>('/catalog/packs')).then((l) => (Array.isArray(l) ? l : []).filter((p) => p && p.accessRequired)),
    { persist: true },
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
    partner: p.partner ?? null,
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

/** Карточка материала (`/catalog/items/:slug`) — только поля, которые читает лаунчер. */
export interface ItemView {
  sourceUrl: string | null
  curseforgeId?: number | null
  launcherOnly?: boolean
  pricing?: Pricing
  priceKopecks?: number | null
  files?: CatalogFile[]
  /* Для страницы материала в лаунчере (`ItemPage`). */
  title?: string
  summary?: string
  description?: { type: string; text?: string; items?: string[] }[] | string | null
  cover?: string | null
  icon?: string | null
  gallery?: string[]
  tags?: string[]
  author?: string | null
  license?: string | null
  side?: string | null
  downloads?: number | null
  updatedAt?: string | null
  edition?: 'JAVA' | 'BEDROCK' | 'BOTH'
  dependencies?: { requires?: { kind: string; slug: string | null; section: string | null; title: string }[] }
  similar?: { slug: string; section: string | null; title: string; summary: string; cover: string | null; icon: string | null; downloads: number | null }[]
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
    const item = sourceOf(card) ?? (await loadItem(card.slug).catch(() => null))
    const source = (item && item.sourceUrl) || ''
    const m = MR_URL.exec(source)
    if (!m) {
      const cfid = item ? await cfProjectOf(item) : null
      return cfid ? { ...baseHit(card), cfid, pid: 'cf:' + cfid } : null
    }
    const mrSlug = decodeURIComponent(m[1]!)
    const proj = await mrProject(mrSlug)
    return { ...baseHit(card), slug: (proj && proj.slug) || mrSlug, pid: proj && proj.id ? String(proj.id) : undefined }
  })
}

/// A listing that already names the source spares a full item request per feed row.
export function sourceOf(card: SiteCard): Pick<ItemView, 'sourceUrl' | 'curseforgeId'> | null {
  if (card.sourceUrl === undefined) return null
  return { sourceUrl: card.sourceUrl, curseforgeId: card.curseforgeId ?? null }
}

/**
 * Карточка материала — одна на строку ленты и на установку: источник, файлы и
 * платность. `fresh` — мимо кэша: после покупки сервер может отдать файлы,
 * которых до неё не показывал.
 */
export function loadItem(slug: string, fresh = false, urgent = false): Promise<ItemView> {
  const key = 'site:item:' + slug
  return fresh ? itemQueued(slug, urgent) : cachedCatalog(key, () => itemQueued(slug, urgent))
}

/** Не больше трёх карточек материала разом: лента — двадцать строк. Сбой не кэшируется. */
let itemsActive = 0
const itemsWaiting: (() => void)[] = []
function itemQueued(slug: string, urgent = false): Promise<ItemView> {
  return new Promise((resolve, reject) => {
    const run = () => {
      itemsActive++
      api<ItemView>('/catalog/items/' + encodeURIComponent(slug))
        .then(resolve, reject)
        .finally(() => {
          itemsActive--
          itemsWaiting.shift()?.()
        })
    }
    // Открытая страница не ждёт двадцать строк ленты.
    if (urgent || itemsActive < 3) run()
    else itemsWaiting.push(run)
  })
}

interface MrRef {
  id: string
  slug: string
}

/*
 * Проект Modrinth для строки ленты — одним запросом на всю пачку.
 *
 * Раньше каждая строка спрашивала свой `/v2/project/:slug`: игрок листал
 * «Ресурсы», и лаунчеры вместе упирались в лимит Modrinth (300 в минуту на
 * адрес сервера). 28.09.2026 прокси из-за этого отвечал «Modrinth перегружен»
 * тысячам запросов, включая установки. `/v2/projects?ids=` отвечает на
 * пятьдесят проектов разом, строки одного экрана собираются в одну пачку.
 */
const MR_BATCH = 50
const MR_BATCH_WAIT_MS = 120
const mrWaiting = new Map<string, ((p: MrRef | null) => void)[]>()
let mrTimer: ReturnType<typeof setTimeout> | null = null

function mrProject(slug: string): Promise<MrRef | null> {
  return new Promise((resolve) => {
    const key = slug.toLowerCase()
    const list = mrWaiting.get(key)
    if (list) list.push(resolve)
    else mrWaiting.set(key, [resolve])
    if (!mrTimer) mrTimer = setTimeout(flushMr, MR_BATCH_WAIT_MS)
  })
}

function flushMr() {
  mrTimer = null
  const batch = [...mrWaiting.entries()].slice(0, MR_BATCH)
  for (const [key] of batch) mrWaiting.delete(key)
  if (mrWaiting.size) mrTimer = setTimeout(flushMr, MR_BATCH_WAIT_MS)
  const ids = batch.map(([key]) => key)
  void fetch(MODRINTH_API + '/v2/projects?ids=' + encodeURIComponent(JSON.stringify(ids)))
    .then((r) => (r.ok ? (r.json() as Promise<MrRef[]>) : []))
    .catch(() => [] as MrRef[])
    .then((found) => {
      const list = Array.isArray(found) ? found : []
      for (const [key, done] of batch) {
        const p = list.find((x) => x && (String(x.slug).toLowerCase() === key || String(x.id).toLowerCase() === key))
        const ref = p ? { id: String(p.id), slug: String(p.slug) } : null
        for (const d of done) d(ref)
      }
    })
}

export function peekHit(card: SiteCard): ModHit | null | undefined {
  if (card.mrHit) return card.mrHit
  if (card.launcherOnly) return ownPackHit(card)
  return peekCatalog<ModHit | null>('site:hit:' + card.slug)
}

export const openOnSite = (section: string, slug: string) => openExt(siteUrl(section, slug))
