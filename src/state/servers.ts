import { create } from 'zustand'
import type { SnapshotServer } from '../lib/snapshot'
import { api } from '../lib/api'
import { serverVersions } from '../lib/mcVersion'
import { ensureMcVersions } from './mcVersions'
import { apiErrorText } from '../lib/apiError'
import { DEFAULT_FILTERS, pageUrl, type ServerFilters } from '../lib/serverQuery'

const CAT: Record<string, string> = {
  SURVIVAL: 'Выживание',
  VANILLA: 'Ванилла',
  MMORPG: 'РПГ',
  ONEBLOCK: 'OneBlock',
  ANARCHY: 'Анархия',
  MINIGAMES: 'Мини-игры',
  OTHER: 'Разное',
  CREATIVE: 'Креатив',
  SKYBLOCK: 'SkyBlock',
  ROLEPLAY: 'RP',
  TECHNIC: 'Техно',
  PVP: 'PvP',
  ADVENTURE: 'Приключения',
  ECONOMY: 'Экономика',
  FACTIONS: 'Фракции',
  HARDCORE: 'Хардкор',
  MODDED: 'Моды',
}

export type RatingStatus = 'idle' | 'loading' | 'ok' | 'error'

export { DEFAULT_FILTERS, PAGE_SIZE, isFiltered, pageUrl } from '../lib/serverQuery'
export type { ServerFilters } from '../lib/serverQuery'

export const SERVER_TABS: [string, string][] = [
  ['Все', ''],
  ['Выживание', 'SURVIVAL'],
  ['Анархия', 'ANARCHY'],
  ['Мини-игры', 'MINIGAMES'],
  ['РПГ', 'MMORPG'],
  ['Ванилла', 'VANILLA'],
  ['Моды', 'MODDED'],
  ['SkyBlock', 'SKYBLOCK'],
  ['Креатив', 'CREATIVE'],
  ['PvP', 'PVP'],
]

export interface CatalogVersion {
  version: string
  servers: number
}

interface ServersState extends ServerFilters {
  list: SnapshotServer[]
  total: number
  versions: CatalogVersion[]
  loadingMore: boolean
  status: RatingStatus
  error: string
  setList: (l: SnapshotServer[]) => void
  set: (patch: Partial<ServersState>) => void
}

export const useServers = create<ServersState>((set) => ({
  ...DEFAULT_FILTERS,
  list: [],
  total: 0,
  versions: [],
  loadingMore: false,
  status: 'idle',
  error: '',
  setList: (l) => set({ list: l }),
  set: (patch) => set(patch as ServersState),
}))

export const currentFilters = (): ServerFilters => {
  const s = useServers.getState()
  return { category: s.category, sort: s.sort, license: s.license, online: s.online, version: s.version, search: s.search }
}

interface RatingServer {
  name: string
  slug: string
  shortDesc?: string
  aiDescription?: string
  description?: string
  ip?: string
  online?: number
  avgOnline?: number
  bannerUrl?: string
  logoUrl?: string
  versionMajors?: string[]
  categories?: string[]
  motd?: string
  license?: string
}

const toCard = (sv: RatingServer, rank: number): SnapshotServer => ({
  rank,
  name: sv.name,
  slug: sv.slug,
  desc: (sv.shortDesc || sv.aiDescription || sv.description || '').replace(/\n/g, ' ').slice(0, 110),
  ip: sv.ip || '',
  online: sv.online ?? sv.avgOnline ?? 0,
  banner: sv.bannerUrl,
  logo: sv.logoUrl,
  versions: serverVersions(sv.versionMajors),
  cat: CAT[(sv.categories || ['OTHER'])[0]] || 'Разное',
  motd: (sv.motd || '').slice(0, 120),
  lic: sv.license || '',
})

interface RatingPage {
  servers?: RatingServer[]
  total?: number
}

// A slow first page must not overwrite the results of the filter picked after
// it, and a "Показать ещё" in flight must not append rows from the old facet.
let seq = 0

export async function loadLiveRating(patch?: Partial<ServerFilters>) {
  const f: ServerFilters = { ...currentFilters(), ...(patch || {}) }
  const my = ++seq
  useServers.getState().set({ ...f, status: 'loading', error: '', loadingMore: false })
  try {
    await ensureMcVersions()
    const d = await api<RatingPage>(pageUrl(0, f))
    if (my !== seq) return
    useServers.getState().set({
      list: (d.servers || []).map((sv, i) => toCard(sv, i + 1)),
      total: d.total ?? (d.servers || []).length,
      status: 'ok',
      error: '',
    })
  } catch (e) {
    if (my !== seq) return
    useServers.getState().set({
      status: 'error',
      error: apiErrorText(e, 'Список серверов не загрузился'),
    })
  }
  void loadCatalogVersions()
}

export async function loadMoreServers() {
  const s = useServers.getState()
  if (s.loadingMore || s.status !== 'ok' || s.list.length >= s.total) return
  const my = seq
  const f = currentFilters()
  s.set({ loadingMore: true })
  try {
    await ensureMcVersions()
    const d = await api<RatingPage>(pageUrl(s.list.length, f))
    if (my !== seq) return
    const cur = useServers.getState()
    const seen = new Set(cur.list.map((x) => x.slug))
    const next = (d.servers || [])
      .filter((sv) => !seen.has(sv.slug))
      .map((sv, i) => toCard(sv, cur.list.length + i + 1))
    cur.set({ list: cur.list.concat(next), total: d.total ?? cur.total, loadingMore: false })
  } catch {
    if (my !== seq) return
    useServers.getState().set({ loadingMore: false })
  }
}

// The version list comes from the catalogue itself, not from the rows already
// on screen: a version whose servers all sit on page three used to be missing
// from the filter entirely.
let versionsPending: Promise<void> | null = null

export function loadCatalogVersions(): Promise<void> {
  if (versionsPending) return versionsPending
  versionsPending = api<CatalogVersion[]>('/rating/servers/versions')
    .then((rows) => {
      const list = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && typeof r.version === 'string' && serverVersions([r.version]).length > 0)
        .map((r) => ({ version: r.version, servers: Number(r.servers) || 0 }))
      if (list.length) useServers.getState().set({ versions: list })
    })
    .catch(() => {
      versionsPending = null
    })
  return versionsPending
}
