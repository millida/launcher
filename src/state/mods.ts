import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { cfSearch, listContent, listWorldInstalls, millidaPacks, packReviewQueue } from '../ipc/commands'
import type { MillidaPack } from '../ipc/commands'
import { fmt } from '../lib/format'
import { MODRINTH_API, mirrorAsset } from '../lib/api'
import { cachedCatalog } from '../lib/catalogCache'
import { mergeSources } from '../lib/modMerge'
import { pickTargetName } from '../lib/installKeys'
import { useProfiles } from './profiles'

export interface ModHit {
  title: string
  author: string
  desc: string
  dl: number
  icon?: string
  cats: string[]
  slug?: string
  pid?: string
  cfid?: number
  website?: string
  /** Адрес нашей сборки в каталоге Millida — ставится не как чужие. */
  packSlug?: string
  /** Платная сборка: ставится по доступу на аккаунте. */
  packPaid?: boolean
  /** Обложка 16:9 для плиток: featured-картинка галереи или первая из неё. */
  cover?: string
  /** Версии игры и загрузчики проекта — из них собирается «Новая сборка». */
  gameVers?: string[]
  loaders?: string[]
  /** Версия этой сборки, которая ждёт проверки. Есть только у проверяющих. */
  packCandidate?: { fileId: string; version: string }
}

/**
 * Версии на проверке, доступные этому аккаунту.
 *
 * Спрашивается один раз на список, а не по сборке: у игрока ответ пустой, и
 * платить за это двадцатью запросами было бы не за что. Сбой не роняет список
 * сборок — без ответа просто нет кнопки проверки.
 */
let reviewQueue: Record<string, { fileId: string; version: string }> = {}

let reviewQueueAt = 0
const REVIEW_QUEUE_TTL = 60_000

export async function refreshReviewQueue(): Promise<void> {
  // Поиск перебирает буквы, и без потолка частоты это запрос на каждую.
  if (Date.now() - reviewQueueAt < REVIEW_QUEUE_TTL) return
  reviewQueueAt = Date.now()
  try {
    const rows = (await packReviewQueue()) || []
    reviewQueue = Object.fromEntries(rows.map((r) => [r.slug, { fileId: r.fileId, version: r.version }]))
  } catch {
    reviewQueue = {}
  }
}

const LOADER_TAGS = ['fabric', 'forge', 'neoforge', 'quilt']

/** Наша сборка в виде строки списка — та же форма, что у чужих источников. */
function packToHit(p: MillidaPack): ModHit {
  return {
    title: p.title,
    // Подпись ставится только у чужой работы. Своё имя рядом с чужой сборкой -
    // это присвоение: сборки собирали не мы, и в каталоге они лежат по
    // договорённости, а не потому что стали нашими.
    author: p.author || '',
    desc: (p.summary || '').slice(0, 120),
    dl: p.downloads,
    icon: p.cover || undefined,
    cats: [p.game, p.loader].filter(Boolean).slice(0, 2),
    slug: p.slug,
    packSlug: p.slug,
    packPaid: p.accessRequired,
    packCandidate: reviewQueue[p.slug],
    pid: 'millida:' + p.slug,
    cover: p.cover || undefined,
    gameVers: p.game ? [p.game] : undefined,
    loaders: p.loader ? [p.loader] : undefined,
  }
}

export const F_VERS = ['любая', '1.21.4', '1.21.1', '1.20.1', '1.19.2', '1.18.2', '1.16.5']
export const F_LOADERS = ['любой', 'fabric', 'forge', 'quilt', 'neoforge']
export const F_SORTS: Record<string, string> = {
  Популярные: 'downloads',
  Новые: 'newest',
  Обновлённые: 'updated',
  'По рейтингу': 'follows',
}

export const F_SIDES: [string, string][] = [
  ['any', 'Любая'],
  ['client', 'Клиент'],
  ['server', 'Сервер'],
]

/**
 * `millida` — наши готовые сборки, отдельной вкладкой и первой.
 *
 * Своей вкладкой, а не строками поверх чужого списка: у наших сборок другой
 * набор фильтров (загрузчик и версия у них уже выбраны автором), другой способ
 * установки и своя платность. Подмешивать их в выдачу Modrinth значило бы
 * показывать полтора десятка карточек в списке на тридцать тысяч и терять их
 * на второй странице.
 */
export const MOD_TABS = ['modpack', 'millida', 'mod', 'resourcepack', 'datapack', 'shader', 'world']

// Worlds exist only on CurseForge (classId 17); Modrinth has no world project type.
export const WORLD_CATS: [number, string][] = [
  [0, 'Все карты'],
  [248, 'Приключения'],
  [249, 'Креатив'],
  [250, 'Мини-игры'],
  [251, 'Паркур'],
  [252, 'Головоломки'],
  [253, 'Выживание'],
  [4464, 'С модами'],
]

// CurseForge sort ids: 2 Popularity, 3 LastUpdated, 6 TotalDownloads.
const CF_SORTS: Record<string, number> = {
  Популярные: 2,
  Новые: 3,
  Обновлённые: 3,
  'По рейтингу': 6,
}

interface ModsState {
  modTab: string
  modSource: string
  mq: string
  fVer: string
  fLoader: string
  fSort: string
  fCat: string
  fCats: string[]
  fSide: string
  fWorldCat: number
  fOpenSource: boolean
  cats: string[]
  vers: string[]
  hits: ModHit[]
  notice: string
  count: string
  offset: number
  cfOffset: number
  showMore: boolean
  installedIds: Set<string>
  targetBuild: string | null
  setVers: (v: string[]) => void
  setCats: (v: string[]) => void
  set: (patch: Partial<ModsState>) => void
  toggleCat: (name: string) => void
  resetFilters: () => void
  load: (append?: boolean) => Promise<void>
  refreshInstalled: () => Promise<void>
  scopeTo: (build: string | null) => void
}

/// The build the catalogue installs into, and therefore the build its rows
/// report about. Один расчёт на весь каталог: строка, ключ задачи и список уже
/// установленного обязаны говорить об одной и той же сборке.
export function catalogTargetBuild(): string {
  const { profiles, selected } = useProfiles.getState()
  return pickTargetName(
    useMods.getState().targetBuild,
    profiles.map((p) => p.name),
    selected || '',
  )
}

async function refreshInstalledIds(kind: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const selected = catalogTargetBuild()
  if (!hasTauri() || !selected) return ids
  if (kind === 'world') {
    try {
      ;(await listWorldInstalls(selected)).forEach((p) => ids.add(p))
    } catch {}
    return ids
  }
  for (const k of ['mod', 'resourcepack', 'datapack', 'shader']) {
    try {
      ;(await listContent(selected, k)).forEach((i) => {
        if (i.project_id) ids.add(i.project_id)
      })
    } catch {}
  }
  return ids
}

function scopeFilters(build: string | null): { fVer: string; fLoader: string } {
  const pr = build ? useProfiles.getState().profiles.find((p) => p.name === build) : null
  if (!pr) return { fVer: 'любая', fLoader: 'любой' }
  const loader = pr.loader || (pr.fabric ? 'fabric' : 'vanilla')
  return {
    fVer: pr.version || 'любая',
    fLoader: F_LOADERS.includes(loader) ? loader : 'любой',
  }
}

// A later answer of an earlier request must not repaint the catalogue: clearing
// the query while a search is still in flight brought the search results back.
let loadSeq = 0

// CurseForge pages hold 50 entries, Modrinth 20. One shared counter meant the
// second CurseForge page started 20 entries in and repeated thirty rows that
// were already on screen.
const CF_PAGE = 50
const MR_PAGE = 20

interface CfQuery {
  query: string
  kind: string
  ver: string
  loader: string
  index: number
  category: number
  sort: number
}

/** Строка каталога из находки CurseForge. Одна на все вкладки: карты ставятся
 *  иначе, но выглядят так же, и две копии этого отображения уже расходились. */
function cfToHit(h: {
  name: string
  summary: string
  downloads: number
  logo: string
  slug: string
  id: number
  website: string
}): ModHit {
  return {
    title: h.name,
    author: 'CurseForge',
    desc: (h.summary || '').slice(0, 120),
    dl: h.downloads,
    icon: mirrorAsset(h.logo),
    cats: [],
    slug: h.slug,
    cfid: h.id,
    website: h.website,
    pid: 'cf:' + h.id,
  }
}

function loadCf(q: CfQuery): Promise<ModHit[]> {
  const key = ['cf', q.kind, q.query, q.ver, q.loader, q.index, q.category, q.sort].join('|')
  return cachedCatalog(key, async () =>
    (await cfSearch(q.query, q.kind, q.ver, q.loader, q.index, q.category, q.sort)).map(cfToHit),
  )
}

interface MrQuery {
  tab: string
  ver: string
  loader: string
  cat: string
  cats: string[]
  side: string
  openSource: boolean
  sort: string
  query: string
  offset: number
}

/// Один сборщик адреса на поиск и на предзагрузку соседних вкладок: разойдись
/// они хоть одним полем — предзагрузка грела бы не тот ключ, и переключение
/// снова стало бы походом в сеть.
function mrSearchUrl(q: MrQuery): string {
  const f: string[][] = [['project_type:' + q.tab]]
  if (q.ver !== 'любая') f.push(['versions:' + q.ver])
  // Loader is a facet only for mods and modpacks; other types have no such category.
  if (q.loader !== 'любой' && (q.tab === 'mod' || q.tab === 'modpack')) f.push(['categories:' + q.loader])
  if (q.cat && q.cat !== 'все') f.push(['categories:' + q.cat])
  q.cats.forEach((c) => f.push(['categories:' + c]))
  if (q.side === 'client') f.push(['client_side:required', 'client_side:optional'])
  if (q.side === 'server') f.push(['server_side:required', 'server_side:optional'])
  if (q.openSource) f.push(['open_source:true'])
  const idx = q.query ? 'relevance' : F_SORTS[q.sort] || 'downloads'
  return (
    MODRINTH_API +
    '/v2/search?limit=' +
    MR_PAGE +
    '&offset=' +
    q.offset +
    '&index=' +
    idx +
    '&facets=' +
    encodeURIComponent(JSON.stringify(f)) +
    (q.query ? '&query=' + encodeURIComponent(q.query) : '')
  )
}

function loadMr(url: string): Promise<any> {
  return cachedCatalog('mr:' + url, async () => (await fetch(url)).json())
}

async function loadPacks(): Promise<MillidaPack[]> {
  // Очередь проверки читается рядом со списком, но МИМО его кэша: список
  // живёт долго, а версия на проверке появляется в середине дня, и ждать
  // протухания кэша проверяющему незачем.
  const [packs] = await Promise.all([
    cachedCatalog('millida:packs', async () => (await millidaPacks()) || []),
    refreshReviewQueue(),
  ])
  return packs
}

/** Наши сборки ищутся на месте: их полтора десятка, и отдельный запрос на
 *  каждую букву был бы дороже самого поиска. */
function packsMatching(list: MillidaPack[], query: string): ModHit[] {
  const q = query.toLowerCase()
  return list
    .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.summary || '').toLowerCase().includes(q))
    .map(packToHit)
}

/** Список категорий Modrinth за сессию не меняется, а спрашивался он при каждом
 *  переключении вкладки — полсотни килобайт за клик. */
export function loadCategoryTags(): Promise<{ project_type: string; name: string }[]> {
  const url = MODRINTH_API + '/v2/tag/category'
  return cachedCatalog(url, async () => (await fetch(url)).json())
}

let warmTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Предзагрузка соседних вкладок.
 *
 * Кэш помогает со второго нажатия, а ждут люди первого. Вкладок семь, фильтры у
 * них общие, и запрос известен заранее — значит, его можно задать, пока человек
 * читает уже показанную выдачу. Греем с задержкой и только при пустом поиске:
 * набранный запрос через полсекунды сменится следующей буквой, и греть его
 * значило бы слать в сеть черновики.
 */
function warmOtherTabs(): void {
  clearTimeout(warmTimer)
  warmTimer = setTimeout(async () => {
    const st = useMods.getState()
    if (st.mq.trim()) return
    const ver = st.fVer === 'любая' ? '' : st.fVer
    for (const tab of MOD_TABS) {
      if (tab === st.modTab) continue
      if (tab === 'millida') {
        await loadPacks().catch(() => {})
        continue
      }
      if (tab === 'world') {
        if (hasTauri())
          await loadCf({
            query: '',
            kind: 'world',
            ver,
            loader: '',
            index: 0,
            category: 0,
            sort: CF_SORTS[st.fSort] || 2,
          }).catch(() => {})
        continue
      }
      if (hasTauri() && (st.modSource === 'all' || st.modSource === 'curseforge'))
        await loadCf({
          query: '',
          kind: tab,
          ver,
          loader: st.fLoader === 'любой' ? '' : st.fLoader,
          index: 0,
          category: 0,
          sort: 0,
        }).catch(() => {})
      if (st.modSource !== 'curseforge')
        await loadMr(
          // Вкладка сбрасывает категории — греем ровно тот адрес, который она и запросит.
          mrSearchUrl({
            tab,
            ver: st.fVer,
            loader: st.fLoader,
            cat: 'все',
            cats: [],
            side: st.fSide,
            openSource: st.fOpenSource,
            sort: st.fSort,
            query: '',
            offset: 0,
          }),
        ).catch(() => {})
    }
  }, 1500)
}

export const useMods = create<ModsState>((set, get) => ({
  // «Каталог Millida» открывается разделом «Сборки».
  modTab: 'modpack',
  modSource: 'all',
  mq: '',
  fVer: 'любая',
  fLoader: 'любой',
  fSort: 'Популярные',
  fCat: 'все',
  fCats: [],
  fSide: 'any',
  fWorldCat: 0,
  fOpenSource: false,
  cats: ['все'],
  vers: [],
  hits: [],
  notice: '',
  count: '',
  offset: 0,
  cfOffset: 0,
  showMore: false,
  installedIds: new Set<string>(),
  targetBuild: null,
  setVers: (v) => set({ vers: v }),
  setCats: (v) => set({ cats: v }),
  set: (patch) => set(patch as ModsState),
  toggleCat: (name) => {
    const cur = get().fCats
    set({ fCats: cur.includes(name) ? cur.filter((c) => c !== name) : cur.concat([name]) })
    void get().load()
  },
  resetFilters: () => {
    set({
      fCats: [],
      fCat: 'все',
      fSide: 'any',
      fWorldCat: 0,
      fOpenSource: false,
      mq: '',
      ...scopeFilters(get().targetBuild),
    })
    void get().load()
  },
  // A finished install has to reach the row that started it: without re-reading
  // the build, the button kept saying «Добавить» over a mod that was already in.
  refreshInstalled: async () => set({ installedIds: await refreshInstalledIds(get().modTab) }),
  // Entering the catalog from a build pre-filters it: content for another game
  // version installs fine and then keeps the game from starting. The typed query
  // belongs to the visit that typed it: kept across builds it silently hid every
  // mod that did not match a search the player had forgotten about.
  scopeTo: (build) => set({ targetBuild: build, mq: '', ...scopeFilters(build) }),
  load: async (append) => {
    const seq = ++loadSeq
    const stale = () => seq !== loadSeq
    const s = get()
    if (!append) {
      set({ offset: 0, cfOffset: 0 })
      // Значки «уже установлено» читаются с диска сборки и первой отрисовке
      // ничего не дают: раньше четыре таких чтения стояли ПЕРЕД запросом
      // каталога и просто добавлялись к ожиданию.
      void refreshInstalledIds(s.modTab).then((ids) => {
        if (!stale()) set({ installedIds: ids })
      })
      warmOtherTabs()
    }
    const st = get()
    // The field keeps what the player typed, the request gets it trimmed.
    const query = st.mq.trim()
    if (st.modTab === 'world') {
      if (!hasTauri()) {
        set({ hits: [], count: '', showMore: false, notice: 'Каталог карт доступен в приложении' })
        return
      }
      const idx = append ? s.cfOffset : 0
      try {
        const hits = await loadCf({
          query,
          kind: 'world',
          ver: st.fVer === 'любая' ? '' : st.fVer,
          loader: '',
          index: idx,
          category: st.fWorldCat,
          sort: CF_SORTS[st.fSort] || 2,
        })
        if (stale()) return
        const all = append ? get().hits.concat(hits) : hits
        set({
          count: all.length ? all.length + ' карт' : '',
          hits: all,
          notice: all.length ? '' : 'Ничего не нашли — попробуй другой запрос или версию',
          cfOffset: idx + hits.length,
          // CurseForge answers 400 past 10 000 results.
          showMore: hits.length >= CF_PAGE && idx + hits.length < 9950,
        })
      } catch (e) {
        if (stale()) return
        set({ hits: [], count: '', showMore: false, notice: 'CurseForge: ' + e })
      }
      return
    }
    if (st.modTab === 'millida') {
      if (!hasTauri()) {
        set({ hits: [], count: '', showMore: false, notice: 'Премиум-сборки ставятся из приложения' })
        return
      }
      try {
        const own = await loadPacks()
        if (stale()) return
        // Премиум - это сборка по ключу доступа, и только она. Остальные наши
        // сборки живут в общем списке: прятать бесплатное за словом «премиум»
        // значит обещать платное там, где его нет.
        const hits = packsMatching(own.filter((pack) => pack.accessRequired), query)
        set({
          hits,
          count: hits.length ? hits.length + ' сборок' : '',
          notice: hits.length
            ? ''
            : query
              ? 'По запросу ничего нет'
              : 'Премиум-сборки появятся здесь',
          showMore: false,
        })
      } catch (e) {
        if (stale()) return
        set({ hits: [], count: '', showMore: false, notice: 'Премиум-сборки недоступны: ' + e })
      }
      return
    }
    /*
     * Свои сборки видно и во вкладке чужих сборок — первой строкой и только на
     * первой странице: человек, пришедший за сборкой вообще, должен увидеть
     * наши раньше, чем тридцать миллионов скачиваний RLCraft.
     */
    const wantsOwn = st.modTab === 'modpack' && !append && hasTauri()
    if (st.modSource === 'curseforge' && !hasTauri()) {
      set({ hits: [], showMore: false, notice: 'CurseForge доступен в приложении' })
      return
    }
    const wantsCf = (st.modSource === 'curseforge' || st.modSource === 'all') && hasTauri()
    const cfOffset = append ? s.cfOffset : 0
    const offset = append ? s.offset : 0
    /*
     * Источники спрашиваются РАЗОМ. Раньше CurseForge дожидались до последнего
     * байта и только потом начинали Modrinth: ожидание игрока было суммой двух
     * походов в сеть там, где хватает одного самого медленного.
     */
    const [own, cf, mr] = await Promise.all([
      wantsOwn ? loadPacks().catch(() => [] as MillidaPack[]) : null,
      wantsCf
        ? loadCf({
            query,
            kind: st.modTab,
            ver: st.fVer === 'любая' ? '' : st.fVer,
            loader: st.fLoader === 'любой' ? '' : st.fLoader,
            index: cfOffset,
            category: 0,
            sort: 0,
          }).then(
            (hits) => ({ hits }),
            (e) => ({ error: String(e) }),
          )
        : null,
      st.modSource === 'curseforge'
        ? null
        : loadMr(
            mrSearchUrl({
              tab: st.modTab,
              ver: st.fVer,
              loader: st.fLoader,
              cat: st.fCat,
              cats: st.fCats,
              side: st.fSide,
              openSource: st.fOpenSource,
              sort: st.fSort,
              query,
              offset,
            }),
          ).then(
            (data) => ({ data }),
            () => null,
          ),
    ])
    if (stale()) return
    if (st.modSource === 'curseforge') {
      if (!cf || 'error' in cf) {
        set({ hits: [], showMore: false, notice: 'CurseForge: ' + (cf ? cf.error : 'нет ответа') })
        return
      }
      const all = append ? get().hits.concat(cf.hits) : cf.hits
      set({
        count: all.length ? all.length + ' результатов' : '',
        hits: all,
        notice: '',
        cfOffset: cfOffset + cf.hits.length,
        showMore: cf.hits.length >= CF_PAGE,
      })
      return
    }
    const cfBuffer: ModHit[] = cf && 'hits' in cf ? cf.hits : []
    if (cf && 'hits' in cf) set({ cfOffset: cfOffset + cfBuffer.length })
    // Свой каталог не отвечает — список чужих источников это не отменяет.
    // Премиум-сборка в общий список не идёт: у неё своя вкладка и свой ключ.
    const ownPacks = own ? packsMatching(own.filter((pack) => !pack.accessRequired), query) : []
    if (!mr) {
      if ((st.modSource === 'all' && cfBuffer.length) || ownPacks.length) {
        const shown = append ? get().hits : []
        const page = ownPacks.concat(mergeSources([], cfBuffer, shown, query))
        set({
          count: shown.length + page.length + ' результатов',
          hits: append ? shown.concat(page) : page,
          notice: '',
          showMore: cfBuffer.length >= CF_PAGE,
        })
      }
      return
    }
    const d = mr.data
    const hits: ModHit[] = (d.hits || []).map((h: any) => ({
      title: h.title,
      author: h.author,
      desc: h.description.slice(0, 120),
      dl: h.downloads,
      icon: mirrorAsset(h.icon_url),
      cats: (h.display_categories || h.categories || []).slice(0, 2),
      slug: h.slug,
      pid: h.project_id,
      cover: mirrorAsset(h.featured_gallery || (h.gallery && h.gallery[0])),
      gameVers: Array.isArray(h.versions) ? h.versions : undefined,
      loaders: (h.categories || []).filter((c: string) => LOADER_TAGS.includes(c)),
    }))
    const shown = append ? get().hits : []
    const merged = st.modSource === 'all' ? mergeSources(hits, cfBuffer, shown, query) : hits
    // Свои сборки первыми и без дублей: тот же адрес мог прийти и из чужого
    // каталога, если автор выложил сборку и туда.
    const page = ownPacks.length
      ? ownPacks.concat(merged.filter((h) => !ownPacks.some((o) => o.slug === h.slug)))
      : merged
    set({
      count:
        st.modSource === 'all'
          ? shown.length + page.length + ' результатов'
          : typeof d.total_hits === 'number'
            ? fmt(d.total_hits) + ' результатов'
            : get().count,
      hits: append ? shown.concat(page) : page,
      notice: '',
      offset: offset + hits.length,
      // Judged by what the sources returned, not by the merged page: a page
      // of pure duplicates would collapse to zero and cut the catalogue off
      // in the middle.
      showMore: hits.length >= MR_PAGE || cfBuffer.length >= CF_PAGE,
    })
  },
}))
