import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { MR_PAGE, loadCf, loadMr, mrSearchUrl, mrToHit, useMods } from '../../state/mods'
import { PER_PAGE, PREMIUM_KEY, SITE_SECTIONS, displayName, facetsKey, listingKey, loadFacets, loadListing, loadPremiumPacks, premiumCard, sectionByKind, sectionBySlug } from './site'
import type { SiteCard, SiteFacets, SiteListing, SiteSlug } from './site'
import { peekCatalog, staleCatalog } from '../../lib/catalogCache'
import { appendMr, cardFromMrHit, cfKind, mrHasMore, mrTarget, nextLoad } from './mrTail'
import type { MrTarget } from './mrTail'
import type { MillidaPack } from '../../ipc/commands'
import { foreignTailAllowed } from './sections'
import type { CatalogSortId, EditionFilter, PriceFilter } from './sections'
import { inTime } from '../../lib/deadline'
import { hasTauri } from '../../ipc/tauri'

/*
 * Состояние каталога сайта в лаунчере: раздел и фильтры — как адрес страницы
 * на millida.net (`/mods/1.21.1/fabric?category=…&q=…&sort=new`), выдача — как
 * её лента. Раздел заодно выставляется в `useMods.modTab`: по нему кнопка
 * строки понимает, что ставит — мод, пак, шейдер или сборку.
 */

export type SiteSort = CatalogSortId
export type SiteAccess = 'all' | 'premium' | 'free'

export interface SiteState {
  section: SiteSlug
  version: string | null
  loader: string | null
  category: string | null
  q: string
  sort: SiteSort
  access: SiteAccess
  /** Издание, «Для чего» и цена — колонки фильтров сайта (30.09.2026). */
  edition: EditionFilter | null
  use: string | null
  price: PriceFilter | null
  items: SiteCard[]
  total: number
  page: number
  pages: number
  facets: SiteFacets | null
  mr: SiteCard[]
  mrTotal: number
  mrOffset: number
  mrMore: boolean
  cf: SiteCard[]
  busy: boolean
  failed: boolean
  /** Сортировки, которые знает сервер (из ответа выдачи). */
  serverSorts: string[]
  /** Показана сохранённая выдача — свежая ещё идёт. */
  stale: boolean
  /** Сервер отвечает дольше обычного — подпись под скелетоном. */
  slow: boolean
  setSection: (s: SiteSlug) => void
  patch: (p: Partial<Pick<SiteState, 'version' | 'loader' | 'category' | 'q' | 'sort' | 'access' | 'edition' | 'use' | 'price'>>) => void
  reset: () => void
  load: (more?: boolean) => Promise<void>
}

export type SiteStore = UseBoundStore<StoreApi<SiteState>>

/** Сколько ждать выдачу: холодный запрос сервера — до 10 с, ядро дублирует зависший запрос через 2,5 с. */
const LISTING_DEADLINE_MS = 25_000
/** С какого момента под скелетоном пишем «отвечает дольше обычного». */
const SLOW_HINT_MS = 3500

const MR_EMPTY = { mr: [] as SiteCard[], mrTotal: 0, mrOffset: 0, mrMore: false, cf: [] as SiteCard[] }

interface MrPage {
  cards: SiteCard[]
  got: number
  total: number
}

async function loadMrPage(
  target: MrTarget,
  st: Pick<SiteState, 'section' | 'version' | 'loader' | 'sort'>,
  q: string,
  offset: number,
): Promise<MrPage> {
  const loaderFacet = st.loader && (target.type === 'mod' || target.type === 'modpack') ? st.loader : null
  const shaderLoader = st.loader && target.type === 'shader' ? [st.loader] : []
  const data = await loadMr(
    mrSearchUrl({
      tab: target.type,
      ver: st.version || 'любая',
      loader: loaderFacet || 'любой',
      cat: target.category || 'все',
      cats: shaderLoader,
      side: 'any',
      openSource: false,
      sort: st.sort === 'new' ? 'Новые' : st.sort === 'updated' ? 'Обновлённые' : st.sort === 'follows' ? 'По рейтингу' : 'Популярные',
      query: q,
      offset,
    }),
  )
  if (!data || !Array.isArray(data.hits)) throw new Error('Modrinth search answered without hits')
  const cards = data.hits
    .map((h: unknown) => cardFromMrHit(mrToHit(h), st.section))
    .filter((c: SiteCard | null): c is SiteCard => !!c)
  return { cards, got: data.hits.length, total: typeof data.total_hits === 'number' ? data.total_hits : 0 }
}

async function loadCfPage(kind: string, st: Pick<SiteState, 'section' | 'version' | 'loader'>, q: string): Promise<SiteCard[]> {
  const hits = await loadCf({
    query: q,
    kind,
    ver: st.version || '',
    loader: st.loader && (kind === 'mod' || kind === 'modpack') ? st.loader : '',
    index: 0,
    category: 0,
    sort: 0,
  })
  return hits.map((h) => cardFromMrHit(h, st.section)).filter((c): c is SiteCard => !!c)
}

/**
 * Состояние одного экземпляра каталога. `linked` — каталог «Ресурсов»: раздел
 * заодно ставится в `useMods.modTab` (по нему кнопка строки понимает, что
 * ставит в сборку). Каталог сервера (вкладка контента хостинга) живёт своим
 * экземпляром: его раздел и фильтры не сбивают «Ресурсы», и наоборот.
 */
/**
 * «Только подходящее» по умолчанию: версия и ядро сборки ставятся ДО первого запроса
 * раздела — иначе раздел грузился дважды (сначала всё, потом под сборку), 10.10.2026.
 * Провайдера задаёт блок «Ставлю в сборку» (SiteCatalog.ForBuild).
 */
let scopeFor: ((section: SiteSlug) => { version: string | null; loader: string | null } | null) | null = null
export function setSectionScope(fn: typeof scopeFor) {
  scopeFor = fn
}

function createSiteStore(linked: boolean): SiteStore {
  let seq = 0
  // Номер последней загрузки «с нуля»: хвосты Modrinth/CF не выбрасываются, если игрок
  // тем временем просто догрузил следующую страницу.
  let base = 0
  return create<SiteState>((set, get) => ({
    section: linked ? sectionByKind(useMods.getState().modTab).slug : 'modpacks',
    version: null,
    loader: null,
    category: null,
    q: '',
    sort: 'recommended',
    access: 'all',
    edition: null,
    use: null,
    price: null,
    items: [],
    total: 0,
    page: 0,
    pages: 0,
    facets: null,
    ...MR_EMPTY,
    busy: false,
    failed: false,
    stale: false,
    slow: false,
    serverSorts: [],
    setSection: (s) => {
      const sec = sectionBySlug(s)
      // Вид установки «Ресурсов» — только у разделов, которые ставятся в сборку:
      // «Все», читы, скины и прочее ставятся своим путём и modTab не трогают.
      if (linked && SITE_SECTIONS.includes(sec)) {
        useMods.getState().set({ modTab: sec.kind, fCats: [], fCat: 'все', count: '' })
        void useMods.getState().refreshInstalled()
      }
      const scope = (linked && scopeFor && scopeFor(s)) || { version: null, loader: null }
      set({ section: s, ...scope, category: null, q: '', access: 'all', edition: null, use: null, price: null, items: [], total: 0, page: 0, facets: null, ...MR_EMPTY })
      void get().load()
    },
    patch: (p) => {
      const before = get()
      const next = { ...p }
      // Как у Modrinth: начал искать — «По релевантности», очистил поиск — снова «Рекомендуемые».
      if (p.q !== undefined && p.sort === undefined) {
        const searching = p.q.trim().length >= 2
        if (searching && before.sort === 'recommended') next.sort = 'relevance'
        if (!searching && before.sort === 'relevance') next.sort = 'recommended'
      }
      if (p.sort === 'relevance' && (p.q ?? before.q).trim().length < 2) next.sort = 'recommended'
      set(next)
      void get().load()
    },
    reset: () => {
      set({ version: null, loader: null, category: null, q: '', access: 'all', edition: null, use: null, price: null })
      void get().load()
    },
    load: async (more) => {
      const my = ++seq
      const st = get()
      if (sectionBySlug(st.section).source !== 'listing') return
      const q = st.q.trim()
      const tail = linked && foreignTailAllowed(st)
      const mrq = tail ? mrTarget(st.section, st.category) : null
      const cfq = tail && hasTauri() ? cfKind(st.section, st.category, q) : null
      if (more && nextLoad(st) !== 'millida') {
        if (!mrq || nextLoad(st) !== 'modrinth') return
        set({ busy: true })
        const got = await inTime(loadMrPage(mrq, st, q.length >= 2 ? q : '', st.mrOffset)).catch(() => null)
        if (my !== seq) return
        if (!got) {
          set({ busy: false })
          return
        }
        set({
          mr: appendMr(get().mr, got.cards),
          mrTotal: got.total,
          mrOffset: st.mrOffset + got.got,
          mrMore: mrHasMore(st.mrOffset, got.got, got.total, MR_PAGE),
          busy: false,
        })
        return
      }
      const page = more ? st.page + 1 : 1
      if (!more) base = my
      const mine = base
      const current = () => my === seq
      set({ busy: true, failed: false, ...(more ? {} : { slow: false }) })
      // Платные сборки — только в «Ресурсах»: на сервер они не ставятся.
      const packs = linked && st.section === 'modpacks'
      const query = {
        section: st.section,
        version: st.version,
        loader: st.loader,
        category: st.category,
        q: q.length >= 2 ? q : null,
        sort: st.sort,
        page,
        perPage: PER_PAGE,
        edition: st.edition,
        use: st.use,
        price: st.price,
      }
      const searching = q.length >= 2
      // Хвосты Modrinth и CurseForge — только при поиске, в фоне; без поиска Modrinth
      // догружается сам, когда лента Millida кончилась (mrMore).
      const tails = !more && searching && (mrq || cfq)
        ? Promise.all([
            mrq ? inTime(loadMrPage(mrq, st, q, 0)).catch(() => null) : Promise.resolve(null),
            cfq ? inTime(loadCfPage(cfq, st, q)).catch(() => [] as SiteCard[]) : Promise.resolve([] as SiteCard[]),
          ])
        : null
      // Платные сборки: сразу — что знаем (память, диск), свежий список — в фоне.
      const premiumNet = packs ? inTime(loadPremiumPacks(), LISTING_DEADLINE_MS).catch(() => null) : Promise.resolve([] as MillidaPack[])
      let premium: MillidaPack[] = packs ? ((await staleCatalog<MillidaPack[]>(PREMIUM_KEY)) ?? []) : []
      if (!current()) return
      let premiumFresh = !packs
      void premiumNet.then((l) => {
        if (!l) return
        premiumFresh = true
        const changed = l.length !== premium.length || l.some((p, i) => p.slug !== premium[i]?.slug)
        premium = l
        // Ответ с платными пришёл позже выдачи — помечаем «Премиум» и ставим Arcania первой.
        if (changed && current() && lastShown) show(lastShown, lastStale)
      })
      // Фильтры — отдельно от ленты: раньше лента ждала их (и самый медленный ответ) целиком.
      if (!more) {
        const fArgs = [st.section, st.version, st.loader, st.edition] as const
        void staleCatalog<SiteFacets>(facetsKey(...fArgs)).then((f) => {
          if (f && mine === base && !peekCatalog(facetsKey(...fArgs))) set({ facets: f })
        })
        void inTime(loadFacets(...fArgs), LISTING_DEADLINE_MS)
          .then((f) => mine === base && set({ facets: f }))
          .catch(() => {})
      }

      let lastShown: SiteListing | null = null
      let lastStale = false
      const show = (listing: SiteListing, stale: boolean) => {
        lastShown = listing
        lastStale = stale
        const paid = new Map(premium.map((p) => [p.slug, p]))
        let got = listing.items.map((c) => {
          const pack = paid.get(c.slug)
          return pack ? { ...c, premium: true, partner: pack.partner ?? null } : c
        })
        if (packs && st.access === 'premium') {
          const only = premiumOnly(premium, st, q)
          set({ items: only, total: only.length, page: 1, pages: 1, ...MR_EMPTY, busy: stale, stale })
          return
        }
        // Релевантность: сервер ищет по вхождению — точное совпадение названия и начало слова
        // поднимаем наверх страницы (как Modrinth: «jei» → сначала JEI, а не всё с «jei» внутри).
        if (st.sort === 'relevance' && q.length >= 2) got = byRelevance(got, q)
        if (packs && st.access === 'free') got = got.filter((c) => !c.premium)
        else if (!more && packs && st.sort === 'recommended') got = pinArcania(got, premium, st, q)
        const hidden = packs && st.access === 'free' ? premium.filter((p) => matchesFilters(p, st, q)).length : 0
        // Лента могла сдвинуться между страницами (новый материал сверху) — без дублей.
        const before = get().items
        const items = more ? before.concat(got.filter((i) => !before.some((x) => x.slug === i.slug))) : got
        // Лента Millida кончится — Modrinth догрузится первой страницей по «Показать ещё» (mrMore).
        const lazyTail = !more && !searching && !!mrq ? { ...MR_EMPTY, mrMore: true } : MR_EMPTY
        const keepTail = more || (stale === false && get().mr.length && searching)
        set({
          items,
          ...(Array.isArray(listing.sorts) ? { serverSorts: listing.sorts } : {}),
          total: Math.max(0, listing.total - hidden),
          page: listing.page,
          pages: listing.pages,
          ...(keepTail ? {} : lazyTail),
          busy: stale,
          stale,
        })
      }

      // Сохранённая выдача того же запроса — сразу, пока сеть несёт свежую.
      if (!more && !peekCatalog(listingKey(query))) {
        const old = await staleCatalog<SiteListing>(listingKey(query))
        if (!current()) return
        if (old && Array.isArray(old.items)) show(old, true)
      }
      // Долго — честно говорим, что ждём (а не «Каталог не ответил» через 10 с).
      const slowTimer = !more ? window.setTimeout(() => current() && get().busy && set({ slow: true }), SLOW_HINT_MS) : 0
      const listingOnce = () => inTime(loadListing(query), LISTING_DEADLINE_MS).catch(() => null)
      let listing = await listingOnce()
      if (!current()) return window.clearTimeout(slowTimer)
      // Один сбой сети — не повод показывать «Каталог не ответил»: тихо пробуем ещё раз.
      if (!listing) {
        await new Promise((r) => setTimeout(r, 800))
        if (!current()) return window.clearTimeout(slowTimer)
        listing = await listingOnce()
        if (!current()) return window.clearTimeout(slowTimer)
      }
      window.clearTimeout(slowTimer)
      if (!listing) {
        // Была сохранённая выдача — оставляем её, ошибку не показываем.
        if (!more && lastShown) set({ busy: false, slow: false })
        else set({ busy: false, slow: false, failed: !more, ...(more ? {} : { items: [] }) })
        return
      }
      // Платные ещё в пути (первый запуск, диска нет) — ждём их недолго: иначе Arcania
      // встанет первой уже после того, как игрок увидел ленту.
      if (!premiumFresh && !premium.length) await Promise.race([premiumNet, new Promise((r) => setTimeout(r, 1500))])
      if (!current()) return
      show(listing, false)
      set({ slow: false })
      if (tails) {
        const [mrFirst, cfFirst] = await tails
        if (mine !== base) return
        set(
          mrFirst
            ? { mr: mrFirst.cards, mrTotal: mrFirst.total, mrOffset: mrFirst.got, mrMore: mrHasMore(0, mrFirst.got, mrFirst.total, MR_PAGE), cf: cfFirst }
            : { cf: cfFirst },
        )
      }
    },
  }))
}

/** Каталог «Ресурсов» (клиент: в сборку). */
export const useSite = createSiteStore(true)
/** Каталог сервера — вкладка контента панели хостинга. */
export const useServerSite = createSiteStore(false)

const ARCANIA = 'arcania'

/** Насколько название совпадает с запросом: целиком, с начала, с начала слова, где-то внутри. */
function matchRank(title: string, q: string): number {
  // Имя как на карточке: без «— скачать мод на Fabric» и «для Minecraft».
  const t = displayName(title).toLowerCase().trim()
  const n = q.toLowerCase().trim()
  if (!n) return 0
  if (t === n) return 4
  if (t.startsWith(n)) return 3
  if (new RegExp('(^|[^\\p{L}\\p{N}])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u').test(t)) return 2
  return t.includes(n) ? 1 : 0
}

/** Стабильная пересортировка страницы: сначала лучшие совпадения, внутри — порядок сервера. */
export function byRelevance(cards: SiteCard[], q: string): SiteCard[] {
  return cards
    .map((c, i) => ({ c, i, r: matchRank(c.title, q) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.c)
}

/** Подходит ли платная сборка под выбранные версию, загрузчик и поиск: категорий у неё нет. */
function matchesFilters(p: MillidaPack, st: Pick<SiteState, 'version' | 'loader' | 'category'> & Partial<Pick<SiteState, 'edition' | 'use' | 'price'>>, q: string): boolean {
  const needle = q.length >= 2 ? q.toLowerCase() : ''
  // Платная сборка Java без задач «Для чего»: под «Бесплатно», Bedrock и задачу не подходит.
  if (st.edition === 'BEDROCK' || st.price === 'free' || st.use) return false
  return (
    !st.category &&
    (!st.version || p.game === st.version) &&
    (!st.loader || p.loader === st.loader) &&
    (!needle || (p.title + ' ' + p.summary).toLowerCase().includes(needle))
  )
}

/**
 * В «Популярных» первой стоит только Arcania, остальные платные идут в ленте
 * вперемешку с бесплатными (владелец, 26.09.2026). Нет её на первой странице —
 * встаёт строкой из каталога сборок, если подходит под фильтры.
 */
function pinArcania(page: SiteCard[], premium: MillidaPack[], st: Pick<SiteState, 'version' | 'loader' | 'category'> & Partial<Pick<SiteState, 'edition' | 'use' | 'price'>>, q: string): SiteCard[] {
  const hit = page.find((c) => c.slug === ARCANIA)
  const pack = premium.find((p) => p.slug === ARCANIA)
  const top = hit || (pack && matchesFilters(pack, st, q) ? premiumCard(pack) : null)
  return top ? [top, ...page.filter((c) => c.slug !== ARCANIA)] : page
}

/** Фильтр «Премиум»: только платные сборки, Arcania первой. */
function premiumOnly(premium: MillidaPack[], st: Pick<SiteState, 'version' | 'loader' | 'category'> & Partial<Pick<SiteState, 'edition' | 'use' | 'price'>>, q: string): SiteCard[] {
  const cards = premium.filter((p) => matchesFilters(p, st, q)).map(premiumCard)
  return [...cards.filter((c) => c.slug === ARCANIA), ...cards.filter((c) => c.slug !== ARCANIA)]
}

/** Сколько фильтров выбрано — число на кнопке «Фильтры» в узком окне. */
export const activeFilters = (
  s: Pick<SiteState, 'version' | 'loader' | 'category'> & { access?: SiteAccess; edition?: string | null; use?: string | null; price?: string | null },
): number =>
  (s.version ? 1 : 0) +
  (s.loader ? 1 : 0) +
  (s.category ? 1 : 0) +
  (s.access && s.access !== 'all' ? 1 : 0) +
  (s.edition ? 1 : 0) +
  (s.use ? 1 : 0) +
  (s.price ? 1 : 0)

/**
 * Прогрев каталога после запуска (в простое): первый вход — «Сборки» без фильтров
 * (владелец 10.10.2026), значит их выдача, фильтры и платные сборки должны быть уже
 * в памяти и на диске. Заодно греется кэш сервера — холодный запрос там до 10 с.
 * Потом, по одному, — соседние разделы.
 */
export function warmCatalog(): void {
  const idle = (fn: () => void, ms: number) => window.setTimeout(() => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : fn()), ms)
  idle(() => {
    void loadListing({ section: 'modpacks', sort: 'recommended', page: 1, perPage: PER_PAGE }).catch(() => {})
    void loadFacets('modpacks').catch(() => {})
    void loadPremiumPacks().catch(() => {})
  }, 1500)
  idle(async () => {
    for (const section of ['mods', 'all', 'shaders', 'texture-packs'] as SiteSlug[]) {
      await loadListing({ section, sort: 'recommended', page: 1, perPage: PER_PAGE }).catch(() => {})
      await loadFacets(section).catch(() => {})
    }
  }, 6000)
}
