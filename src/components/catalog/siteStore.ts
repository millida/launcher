import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { MR_PAGE, loadMr, mrSearchUrl, mrToHit, useMods } from '../../state/mods'
import { PER_PAGE, loadFacets, loadListing, loadPremiumPacks, premiumCard, sectionByKind, sectionBySlug } from './site'
import type { SiteCard, SiteFacets, SiteSlug } from './site'
import { appendMr, cardFromMrHit, mrHasMore, mrTarget, nextLoad } from './mrTail'
import type { MrTarget } from './mrTail'
import type { MillidaPack } from '../../ipc/commands'
import { inTime } from '../../lib/deadline'

/*
 * Состояние каталога сайта в лаунчере: раздел и фильтры — как адрес страницы
 * на millida.net (`/mods/1.21.1/fabric?category=…&q=…&sort=new`), выдача — как
 * её лента. Раздел заодно выставляется в `useMods.modTab`: по нему кнопка
 * строки понимает, что ставит — мод, пак, шейдер или сборку.
 */

export type SiteSort = 'popular' | 'new'

export interface SiteState {
  section: SiteSlug
  version: string | null
  loader: string | null
  category: string | null
  q: string
  sort: SiteSort
  items: SiteCard[]
  total: number
  page: number
  pages: number
  facets: SiteFacets | null
  mr: SiteCard[]
  mrTotal: number
  mrOffset: number
  mrMore: boolean
  busy: boolean
  failed: boolean
  setSection: (s: SiteSlug) => void
  patch: (p: Partial<Pick<SiteState, 'version' | 'loader' | 'category' | 'q' | 'sort'>>) => void
  reset: () => void
  load: (more?: boolean) => Promise<void>
}

export type SiteStore = UseBoundStore<StoreApi<SiteState>>

const MR_EMPTY = { mr: [] as SiteCard[], mrTotal: 0, mrOffset: 0, mrMore: false }

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
      sort: st.sort === 'new' ? 'Новые' : 'Популярные',
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

/**
 * Состояние одного экземпляра каталога. `linked` — каталог «Ресурсов»: раздел
 * заодно ставится в `useMods.modTab` (по нему кнопка строки понимает, что
 * ставит в сборку). Каталог сервера (вкладка контента хостинга) живёт своим
 * экземпляром: его раздел и фильтры не сбивают «Ресурсы», и наоборот.
 */
function createSiteStore(linked: boolean): SiteStore {
  let seq = 0
  return create<SiteState>((set, get) => ({
    section: linked ? sectionByKind(useMods.getState().modTab).slug : 'modpacks',
    version: null,
    loader: null,
    category: null,
    q: '',
    sort: 'popular',
    items: [],
    total: 0,
    page: 0,
    pages: 0,
    facets: null,
    ...MR_EMPTY,
    busy: false,
    failed: false,
    setSection: (s) => {
      const sec = sectionBySlug(s)
      if (linked) {
        useMods.getState().set({ modTab: sec.kind, fCats: [], fCat: 'все', count: '' })
        void useMods.getState().refreshInstalled()
      }
      set({ section: s, version: null, loader: null, category: null, q: '', items: [], total: 0, page: 0, facets: null, ...MR_EMPTY })
      void get().load()
    },
    patch: (p) => {
      set(p)
      void get().load()
    },
    reset: () => {
      set({ version: null, loader: null, category: null, q: '' })
      void get().load()
    },
    load: async (more) => {
      const my = ++seq
      const st = get()
      if (sectionBySlug(st.section).kind === 'world') return
      const q = st.q.trim()
      const mrq = linked ? mrTarget(st.section, st.category) : null
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
      set({ busy: true, failed: false })
      // Платные сборки — только в «Ресурсах»: на сервер они не ставятся.
      const packs = linked && st.section === 'modpacks'
      const [listing, facets, premium, mrFirst] = await Promise.all([
        inTime(loadListing({
          section: st.section,
          version: st.version,
          loader: st.loader,
          category: st.category,
          q: q.length >= 2 ? q : null,
          sort: st.sort,
          page,
          perPage: PER_PAGE,
        })).catch(() => null),
        more ? Promise.resolve(get().facets) : inTime(loadFacets(st.section, st.version, st.loader)).catch(() => null),
        packs ? inTime(loadPremiumPacks()).catch(() => [] as MillidaPack[]) : Promise.resolve([] as MillidaPack[]),
        !more && mrq ? inTime(loadMrPage(mrq, st, q.length >= 2 ? q : '', 0)).catch(() => null) : Promise.resolve(null),
      ])
      if (my !== seq) return
      if (!listing) {
        set({ busy: false, failed: !more, ...(more ? {} : { items: [] }) })
        return
      }
      const paid = new Set(premium.map((p) => p.slug))
      let got = listing.items.map((c) => (paid.has(c.slug) ? { ...c, premium: true } : c))
      if (!more && packs && st.sort === 'popular') got = pinPremium(got, premium, st, q)
      // Лента могла сдвинуться между страницами (новый материал сверху) — без дублей.
      const items = more ? get().items.concat(got.filter((i) => !get().items.some((x) => x.slug === i.slug))) : got
      const mrState = more
        ? {}
        : mrFirst
          ? { mr: mrFirst.cards, mrTotal: mrFirst.total, mrOffset: mrFirst.got, mrMore: mrHasMore(0, mrFirst.got, mrFirst.total, MR_PAGE) }
          : MR_EMPTY
      set({ items, total: listing.total, page: listing.page, pages: listing.pages, facets: facets || get().facets, ...mrState, busy: false })
    },
  }))
}

/** Каталог «Ресурсов» (клиент: в сборку). */
export const useSite = createSiteStore(true)
/** Каталог сервера — вкладка контента панели хостинга. */
export const useServerSite = createSiteStore(false)

/**
 * Платные сборки — первыми в «Популярных» (правка владельца 24.09.2026, 16:39:
 * «Arcania — первой»). Порядок — как в `/catalog/packs`. Сборка, которой нет на
 * первой странице выдачи, встаёт строкой из каталога сборок, если подходит под
 * выбранные версию, загрузчик и поиск; под категорию — только если её вернул
 * сам сайт (категорий у карточки сборки нет).
 */
function pinPremium(page: SiteCard[], premium: MillidaPack[], st: Pick<SiteState, 'version' | 'loader' | 'category'>, q: string): SiteCard[] {
  if (!premium.length) return page
  const needle = q.length >= 2 ? q.toLowerCase() : ''
  const top: SiteCard[] = []
  for (const p of premium) {
    const hit = page.find((c) => c.slug === p.slug)
    if (hit) top.push(hit)
    else if (
      !st.category &&
      (!st.version || p.game === st.version) &&
      (!st.loader || p.loader === st.loader) &&
      (!needle || (p.title + ' ' + p.summary).toLowerCase().includes(needle))
    )
      top.push(premiumCard(p))
  }
  const slugs = new Set(top.map((c) => c.slug))
  return top.concat(page.filter((c) => !slugs.has(c.slug)))
}

/** Сколько фильтров выбрано — число на кнопке «Фильтры» в узком окне. */
export const activeFilters = (s: Pick<SiteState, 'version' | 'loader' | 'category'>): number =>
  (s.version ? 1 : 0) + (s.loader ? 1 : 0) + (s.category ? 1 : 0)
