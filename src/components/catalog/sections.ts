/*
 * Разделы каталога лаунчера = разделы millida.net (приказ владельца 30.09.2026:
 * «каталог лаунчера должен быть идентичен нашему каталогу на сайте»).
 *
 * Группы и порядок — `src/lib/catalog-type-tabs.ts` сайта (CATALOG_NAV_GROUPS),
 * значки и цвета — `src/lib/catalog-section-visual.ts` и токены `--m-sec-*`
 * (`millida-kit.css`). Значки здесь пиксельные (PxIcon) — язык лаунчера, но смысл
 * тот же, что у значка Tabler на сайте. Модуль чистый: без React и сети.
 */

import { t } from '../../i18n'

export type SectionSlug =
  | 'all'
  | 'modpacks'
  | 'server-packs'
  | 'mods'
  | 'plugins'
  | 'data-packs'
  | 'texture-packs'
  | 'shaders'
  | 'maps'
  | 'seeds'
  | 'skins'
  | 'capes'
  | 'heads'

export interface NavTab {
  slug: SectionSlug
  label: string
}

export interface NavGroup {
  key: string
  label: string
  tabs: NavTab[]
}

const tab = (slug: SectionSlug, label: () => string): NavTab => ({
  slug,
  get label() {
    return label()
  },
})

/**
 * Как на сайте (голосовое владельца 29.09.2026), но без серверных сборок
 * и голов (владелец 30.09.2026, 21:04: «в лаунчере слишком много всего»).
 * Серверные сборки остаются во вкладке контента хостинга (SERVER_SECTIONS).
 */
export const LAUNCHER_HIDDEN: ReadonlySet<string> = new Set(['server-packs', 'heads'])
export const CATALOG_GROUPS: NavGroup[] = [
  {
    key: 'all',
    get label() {
      return t('Все')
    },
    tabs: [tab('all', () => t('Все'))],
  },
  {
    key: 'packs',
    get label() {
      return t('Сборки')
    },
    tabs: [tab('modpacks', () => t('Сборки модов'))],
  },
  {
    key: 'mods',
    get label() {
      return t('Моды')
    },
    tabs: [tab('mods', () => t('Моды')), tab('plugins', () => t('Плагины')), tab('data-packs', () => t('Дата-паки'))],
  },
  {
    key: 'graphics',
    get label() {
      return t('Графика')
    },
    tabs: [tab('texture-packs', () => t('Ресурс-паки')), tab('shaders', () => t('Шейдеры'))],
  },
  {
    key: 'worlds',
    get label() {
      return t('Карты')
    },
    tabs: [tab('maps', () => t('Карты')), tab('seeds', () => t('Сиды'))],
  },
  {
    key: 'looks',
    get label() {
      return t('Скины')
    },
    tabs: [tab('skins', () => t('Скины')), tab('capes', () => t('Плащи'))],
  },
]

export const CATALOG_TABS: NavTab[] = CATALOG_GROUPS.flatMap((g) => g.tabs)

export interface SectionVisual {
  /** Имя пиксельного значка (`pxArt.ts`). */
  px: string
  /** Цвет значка — токен раздела, как на сайте. */
  tint: string
}

export const SECTION_VISUAL: Record<SectionSlug, SectionVisual> = {
  all: { px: 'grid', tint: 'var(--m-sec-all)' },
  modpacks: { px: 'box', tint: 'var(--m-sec-modpacks)' },
  'server-packs': { px: 'server', tint: 'var(--m-sec-server-packs)' },
  mods: { px: 'blocks', tint: 'var(--m-sec-mods)' },
  plugins: { px: 'zap', tint: 'var(--m-sec-plugins)' },
  'data-packs': { px: 'book', tint: 'var(--m-sec-data-packs)' },
  'texture-packs': { px: 'brush', tint: 'var(--m-sec-texture-packs)' },
  shaders: { px: 'sun', tint: 'var(--m-sec-shaders)' },
  maps: { px: 'map', tint: 'var(--m-sec-maps)' },
  seeds: { px: 'sparkle', tint: 'var(--m-sec-seeds)' },
  skins: { px: 'shirt', tint: 'var(--m-sec-skins)' },
  capes: { px: 'cape', tint: 'var(--m-sec-capes)' },
  heads: { px: 'ws-head', tint: 'var(--m-sec-heads)' },
}

/** Группа носит значок и цвет своего первого раздела — как в шапке сайта. */
export const groupVisual = (g: NavGroup): SectionVisual => SECTION_VISUAL[g.tabs[0]!.slug]

export const groupOf = (slug: string): NavGroup => CATALOG_GROUPS.find((g) => g.tabs.some((t) => t.slug === slug)) || CATALOG_GROUPS[0]!

/**
 * Откуда лента раздела:
 *  - listing — `/v2/catalog/listing` и `/facets`, как страница раздела сайта;
 *  - skins — `/v2/skins`, сетка скинов сайта;
 *  - site — раздел живёт на сайте (сиды — строка для поля «Сид», головы —
 *    команда /give), плащи — в гардеробе лаунчера.
 */
export type SectionSource = 'listing' | 'skins' | 'site'

export const SECTION_SOURCE: Record<SectionSlug, SectionSource> = {
  all: 'listing',
  modpacks: 'listing',
  'server-packs': 'listing',
  mods: 'listing',
  plugins: 'listing',
  'data-packs': 'listing',
  'texture-packs': 'listing',
  shaders: 'listing',
  maps: 'listing',
  seeds: 'site',
  skins: 'skins',
  capes: 'site',
  heads: 'site',
}

/** Адрес раздела на сайте: скины и головы живут не в корне каталога. */
export function siteSectionPath(slug: SectionSlug): string {
  if (slug === 'skins') return '/skins/katalog'
  if (slug === 'heads') return '/tools/golovy'
  return '/' + slug
}

/** Цена в фильтре: `price=free|paid` листинга, как колонка «Цена» сайта. */
export type PriceFilter = 'free' | 'paid'
/** `side=client`: a mod installed only by the player, not needed on the server. */
export type SideFilter = 'client'

export interface ListingFilters {
  version?: string | null
  loader?: string | null
  category?: string | null
  q?: string | null
  sort?: CatalogSortId
  page?: number
  perPage?: number
  use?: string | null
  price?: PriceFilter | null
  side?: SideFilter | null
  /** Only modpacks that ship this mod (catalogue slug or Modrinth id). */
  withMod?: string | null
}

/** Строка запроса листинга — те же имена и правила, что у `catalogApi.listing` сайта. */
/**
 * Сортировки как у Modrinth (владелец 10.10.2026): релевантность — при поиске, скачивания,
 * подписчики, новые, обновлённые. «Рекомендуемые» — наша (скачивания × свежесть × медиа).
 * Подписчиков и «обновлённых» старый сервер не знает: их показываем, только когда сервер
 * перечислил их в ответе (`sorts`).
 */
export type CatalogSortId = 'relevance' | 'recommended' | 'popular' | 'follows' | 'new' | 'updated'
export function listingQuery(section: SectionSlug, f: ListingFilters): string {
  const sp = new URLSearchParams({ section })
  if (f.version) sp.set('version', f.version)
  if (f.loader) sp.set('loader', f.loader)
  if (f.category) sp.set('category', f.category)
  if (f.q && f.q.trim().length >= 2) sp.set('q', f.q.trim())
  if (f.price) sp.set('price', f.price)
  if (f.use) sp.set('use', f.use)
  if (f.side) sp.set('side', f.side)
  if (f.withMod) sp.set('withMod', f.withMod)
  // Как на сайте: «Рекомендуемые» — без параметра, «Популярные» и «Новые» — параметром.
  // «По релевантности» у сервера — это популярное среди найденного (сервер ищет по вхождению),
  // ближе всего к Modrinth; точные совпадения названия лаунчер поднимает сам (siteStore).
  if (f.sort === 'relevance') sp.set('sort', 'popular')
  else if (f.sort && f.sort !== 'recommended') sp.set('sort', f.sort)
  if (f.page && f.page > 1) sp.set('page', String(f.page))
  if (f.perPage) sp.set('perPage', String(f.perPage))
  return sp.toString()
}

/**
 * Хвост из Modrinth и CurseForge дописывается только к «чистой» выдаче: у чужих
 * источников нет ни платного, ни задач «Для чего» — с такими
 * фильтрами хвост показывал бы не то, что выбрано.
 */
export const foreignTailAllowed = (f: Pick<ListingFilters, 'use' | 'price' | 'side'>): boolean =>
  !f.use && f.price !== 'paid' && !f.side

/** Сиды, головы, плащи — лаунчер ведёт на сайт или в гардероб, ленты у них нет. */
export const hasFeed = (slug: SectionSlug): boolean => SECTION_SOURCE[slug] !== 'site'

/** Разделы, которые «Скачать в лаунчере» сайта шлёт в millida://install/… (см. millidaCatalog.INSTALL_SECTIONS). */
export const SITE_INSTALL_SECTIONS: SectionSlug[] = ['mods', 'modpacks', 'texture-packs', 'shaders', 'data-packs', 'maps', 'skins', 'capes']
