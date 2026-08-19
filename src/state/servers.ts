import { create } from 'zustand'
import type { SnapshotServer } from '../lib/snapshot'
import { api } from '../lib/api'
import { serverVersions } from '../lib/mcVersion'
import { ensureMcVersions } from './mcVersions'
import { apiErrorText } from '../lib/apiError'

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

export const PAGE_SIZE = 30

// Category filtering happens API-side: paginated results cannot be filtered locally.
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

interface ServersState {
  list: SnapshotServer[]
  promo: SnapshotServer[]
  total: number
  category: string
  loadingMore: boolean
  status: RatingStatus
  error: string
  setList: (l: SnapshotServer[]) => void
  set: (patch: Partial<ServersState>) => void
}

export const useServers = create<ServersState>((set) => ({
  list: [],
  promo: [],
  total: 0,
  category: '',
  loadingMore: false,
  status: 'idle',
  error: '',
  setList: (l) => set({ list: l }),
  set: (patch) => set(patch as ServersState),
}))

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
  topThree?: RatingServer[]
  total?: number
}

const pageUrl = (offset: number, category: string) =>
  '/rating/servers?limit=' + PAGE_SIZE + '&offset=' + offset + '&sort=rating' + (category ? '&category=' + category : '')

export async function loadLiveRating(category?: string) {
  const s = useServers.getState()
  if (s.status === 'loading') return
  const cat = category ?? s.category
  s.set({ status: 'loading', error: '', category: cat })
  try {
    await ensureMcVersions()
    const d = await api<RatingPage>(pageUrl(0, cat))
    useServers.getState().set({
      list: (d.servers || []).map((sv, i) => toCard(sv, i + 1)),
      promo: (d.topThree || []).map((sv) => toCard(sv, 0)),
      total: d.total ?? (d.servers || []).length,
      status: 'ok',
      error: '',
    })
  } catch (e) {
    useServers.getState().set({
      status: 'error',
      error: apiErrorText(e, 'Список серверов не загрузился'),
    })
  }
}

export async function loadMoreServers() {
  const s = useServers.getState()
  if (s.loadingMore || s.status !== 'ok' || s.list.length >= s.total) return
  s.set({ loadingMore: true })
  try {
    await ensureMcVersions()
    const d = await api<RatingPage>(pageUrl(s.list.length, s.category))
    const cur = useServers.getState()
    const seen = new Set(cur.list.map((x) => x.slug))
    const next = (d.servers || [])
      .filter((sv) => !seen.has(sv.slug))
      .map((sv, i) => toCard(sv, cur.list.length + i + 1))
    cur.set({ list: cur.list.concat(next), total: d.total ?? cur.total, loadingMore: false })
  } catch {
    useServers.getState().set({ loadingMore: false })
  }
}
