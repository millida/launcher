import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { cfSearch, listContent, listWorldInstalls } from '../ipc/commands'
import { fmt } from '../lib/format'
import { mergeSources } from '../lib/modMerge'
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

export const MOD_TABS = ['modpack', 'mod', 'resourcepack', 'datapack', 'shader', 'world']

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
  scopeTo: (build: string | null) => void
}

async function refreshInstalledIds(kind: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const selected = useMods.getState().targetBuild || useProfiles.getState().selected
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

let cfBuffer: ModHit[] = []

// CurseForge pages hold 50 entries, Modrinth 20. One shared counter meant the
// second CurseForge page started 20 entries in and repeated thirty rows that
// were already on screen.
const CF_PAGE = 50
const MR_PAGE = 20

export const useMods = create<ModsState>((set, get) => ({
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
  // Entering the catalog from a build pre-filters it: content for another game
  // version installs fine and then keeps the game from starting.
  scopeTo: (build) => set({ targetBuild: build, ...scopeFilters(build) }),
  load: async (append) => {
    const s = get()
    if (!append) {
      set({ offset: 0, cfOffset: 0, installedIds: await refreshInstalledIds(s.modTab) })
    }
    const st = get()
    if (st.modTab === 'world') {
      if (!hasTauri()) {
        set({ hits: [], count: '', showMore: false, notice: 'Каталог карт доступен в приложении' })
        return
      }
      const idx = append ? s.cfOffset : 0
      try {
        const raw = await cfSearch(
          st.mq,
          'world',
          st.fVer === 'любая' ? '' : st.fVer,
          '',
          idx,
          st.fWorldCat,
          CF_SORTS[st.fSort] || 2,
        )
        const hits: ModHit[] = raw.map((h) => ({
          title: h.name,
          author: 'CurseForge',
          desc: (h.summary || '').slice(0, 120),
          dl: h.downloads,
          icon: h.logo,
          cats: [],
          slug: h.slug,
          cfid: h.id,
          website: h.website,
          pid: 'cf:' + h.id,
        }))
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
        set({ hits: [], count: '', showMore: false, notice: 'CurseForge: ' + e })
      }
      return
    }
    if (st.modSource === 'curseforge' || st.modSource === 'all') {
      if (!hasTauri() && st.modSource === 'curseforge') {
        set({ hits: [], showMore: false, notice: 'CurseForge доступен в приложении' })
        return
      }
      const cfOffset = append ? s.cfOffset : 0
      if (hasTauri()) {
        try {
          const loader = st.fLoader === 'любой' ? '' : st.fLoader
          const raw = await cfSearch(st.mq, st.modTab, st.fVer === 'любая' ? '' : st.fVer, loader, cfOffset)
          const hits: ModHit[] = raw.map((h) => ({
            title: h.name,
            author: 'CurseForge',
            desc: (h.summary || '').slice(0, 120),
            dl: h.downloads,
            icon: h.logo,
            cats: [],
            slug: h.slug,
            cfid: h.id,
            website: h.website,
            pid: 'cf:' + h.id,
          }))
          if (st.modSource === 'curseforge') {
            const all = append ? get().hits.concat(hits) : hits
            set({
              count: all.length ? all.length + ' результатов' : '',
              hits: all,
              notice: '',
              cfOffset: cfOffset + hits.length,
              showMore: hits.length >= CF_PAGE,
            })
            return
          }
          set({ cfOffset: cfOffset + hits.length })
          cfBuffer = hits
        } catch (e) {
          if (st.modSource === 'curseforge') {
            set({ hits: [], showMore: false, notice: 'CurseForge: ' + e })
            return
          }
          cfBuffer = []
        }
      } else {
        cfBuffer = []
      }
    }
    const f: string[][] = [['project_type:' + st.modTab]]
    if (st.fVer !== 'любая') f.push(['versions:' + st.fVer])
    // Loader is a facet only for mods and modpacks; other types have no such category.
    if (st.fLoader !== 'любой' && (st.modTab === 'mod' || st.modTab === 'modpack'))
      f.push(['categories:' + st.fLoader])
    if (st.fCat && st.fCat !== 'все') f.push(['categories:' + st.fCat])
    st.fCats.forEach((c) => f.push(['categories:' + c]))
    if (st.fSide === 'client') f.push(['client_side:required', 'client_side:optional'])
    if (st.fSide === 'server') f.push(['server_side:required', 'server_side:optional'])
    if (st.fOpenSource) f.push(['open_source:true'])
    const facets = encodeURIComponent(JSON.stringify(f))
    const idx = st.mq ? 'relevance' : F_SORTS[st.fSort] || 'downloads'
    const offset = append ? s.offset : 0
    const url =
      'https://api.modrinth.com/v2/search?limit=20&offset=' +
      offset +
      '&index=' +
      idx +
      '&facets=' +
      facets +
      (st.mq ? '&query=' + encodeURIComponent(st.mq) : '')
    try {
      const d = await (await fetch(url)).json()
      const hits: ModHit[] = (d.hits || []).map((h: any) => ({
        title: h.title,
        author: h.author,
        desc: h.description.slice(0, 120),
        dl: h.downloads,
        icon: h.icon_url,
        cats: (h.display_categories || h.categories || []).slice(0, 2),
        slug: h.slug,
        pid: h.project_id,
      }))
      const shown = append ? get().hits : []
      const cfPage = cfBuffer
      const page = st.modSource === 'all' ? mergeSources(hits, cfPage, shown) : hits
      cfBuffer = []
      set({
        count:
          st.modSource === 'all'
            ? (shown.length + page.length) + ' результатов'
            : typeof d.total_hits === 'number'
              ? fmt(d.total_hits) + ' результатов'
              : get().count,
        hits: append ? shown.concat(page) : page,
        notice: '',
        offset: offset + hits.length,
        // Judged by what the sources returned, not by the merged page: a page
        // of pure duplicates would collapse to zero and cut the catalogue off
        // in the middle.
        showMore: hits.length >= MR_PAGE || cfPage.length >= CF_PAGE,
      })
    } catch {
      if (st.modSource === 'all' && cfBuffer.length) {
        const shown = append ? get().hits : []
        const cfPage = cfBuffer
        cfBuffer = []
        const page = mergeSources([], cfPage, shown)
        set({
          count: shown.length + page.length + ' результатов',
          hits: append ? shown.concat(page) : page,
          notice: '',
          showMore: cfPage.length >= CF_PAGE,
        })
      }
    }
  },
}))
