import { create } from 'zustand'
import { api } from '../lib/api'

/**
 * PvP-тиры Millida SMP (владелец 11.10.2026: «где огоньки и место по часам —
 * чтоб писался твой PvP-тир и был топ тиров»). Данные — тир-лист сервера
 * mpvp.millida.host: /v2/tiers/player/<ник> и /v2/tiers/overall.
 */

/** Сервер дуэлей: туда ведёт «Определить свой тир». Пускает только аккаунт Millida. */
export const TIER_SERVER = { ip: 'mpvp.millida.host', name: 'Millida SMP', versions: ['26.2'] }

export interface TierMode {
  tier: string
  peak: string
  verified: boolean
  elo: number
  games: number
  wins: number
  losses: number
  streak?: number
  bestStreak?: number
  /** Место в топе режима. */
  rank?: number
  /** Подсказка сервера, что дальше: «калибровка: ещё 2 рейтинговых боя», «до HT2 — обгони Nick (ещё 23 ELO)». */
  next?: string
  /** Открыт тест на этот тир (выше LT3 тир берётся матчем с игроком, как у MCPVP): встать в рейтинговый поиск. */
  test?: string
  /** Когда тир спадёт без рейтинговых игр: через 30 дней становится «???». */
  lastRatedAt?: number
  decayAt?: number
}

export interface TierPlayer {
  uuid: string
  name: string
  points: number
  title: string
  modes: Record<string, TierMode>
  /** Общий тир по очкам (MT4) и место в общем топе. */
  overallTier?: string
  rank?: number
  region?: string
  online?: boolean
  /** Место и очки сезона, неделя (сервер отдаёт с 12.10.2026; раньше — искали в топах). */
  season?: { pos?: number; score?: number; division?: string }
  week?: { pos?: number; wins?: number; games?: number; eloDelta?: number }
}

export interface TierTopEntry {
  pos: number
  uuid: string
  name: string
  points: number
  title: string
  tiers: Record<string, string>
  overallTier?: string
  region?: string
}

/** Матч из истории игрока (/tiers/player/<ник>/matches). */
export interface TierMatch {
  id: number
  playedAt: number
  kit: string
  opponent: string
  score: string
  win: boolean
  /** ranked — на рейтинг, casual/duel — без изменения ELO. */
  type: string
  delta: number
  elo: number
}

/** Сезон: дивизионы по очкам сезона (Бронза … Мастер) и сколько дней осталось. */
export interface TierSeason {
  title: string
  number?: number
  daysLeft?: number
  divisions: { min: number; color: string; name: string }[]
}

/** Порог тира: сколько ELO и боёв нужно (/tiers/rules). */
export interface TierRule {
  tier: string
  points: number
  minElo: number
  minGames: number
}

export interface TierModeInfo {
  slug: string
  title: string
  first_to: number
}

/** Строка топа одного режима (/tiers/mode/<kit>). */
export interface TierKitRow {
  pos: number
  uuid: string
  name: string
  tier: string
  peak: string
  elo: number
  wins: number
  losses: number
}

/** Свежее изменение тира (/tiers/recent): экзамен или ранговые дуэли. */
export interface TierRecent {
  uuid: string
  name: string
  kit: string
  to: string
  from?: string
  source: string
  ts: number
}

export interface TierKitStats {
  title: string
  players: number
  queued: number
  fighting: number
  matchesMonth?: number
}

/** Строка сезонного или недельного топа — поля появятся в API плагина; пустые — не показываем. */
export interface TierPeriodRow {
  pos: number
  uuid?: string
  name: string
  score?: number
  sr?: number
  wins?: number
  games?: number
  eloDelta?: number
  division?: string
}

export type TierPeriod = 'tier' | 'season' | 'week'

/** Иконка режима: предмет Minecraft из public/mode-art/kits (как на millida.net/tiers). */
export const kitIcon = (slug: string): string => '/mode-art/kits/' + slug + '.png'

/**
 * Место тира в лестнице: HT1 = 0 (лучший), MT1 = 1, LT1 = 2, HT2 = 3 … LT5 = 14;
 * не тир — null. MT — средняя ступень, как у MCPVP (сервер с 11.10.2026).
 */
export function tierRank(t: string | undefined | null): number | null {
  const m = /^(H|M|L)T([1-5])$/.exec((t || '').trim().toUpperCase())
  return m ? (Number(m[2]) - 1) * 3 + 'HML'.indexOf(m[1]) : null
}

/** Ступень 1–5 для цвета значка. */
export const tierLevel = (t: string): number => Number(t.slice(-1)) || 5

/** Лучший тир из набора «режим → тир»; при равенстве — режим, что идёт раньше в списке режимов. */
export function bestTier(tiers: Record<string, string>, order: string[] = []): { mode: string; tier: string } | null {
  let best: { mode: string; tier: string; r: number; o: number } | null = null
  for (const [mode, tier] of Object.entries(tiers)) {
    const r = tierRank(tier)
    if (r === null) continue
    const o = order.indexOf(mode) === -1 ? order.length : order.indexOf(mode)
    if (!best || r < best.r || (r === best.r && o < best.o)) best = { mode, tier: tier.toUpperCase(), r, o }
  }
  return best ? { mode: best.mode, tier: best.tier } : null
}

/** Тиры игрока по режимам — из ответа /tiers/player. */
export const playerTiers = (p: TierPlayer): Record<string, string> =>
  // Плагин отдаёт «NONE» у режимов без тира — такие не считаем.
  Object.fromEntries(Object.entries(p.modes || {}).filter(([, v]) => tierRank(v.tier) !== null).map(([k, v]) => [k, v.tier.toUpperCase()]))

/** Тир-лист пересчитывается после матчей — чаще раза в 2 минуты спрашивать незачем. */
const FRESH_MS = 2 * 60_000

interface State {
  /** Что открыто на вкладке: все режимы или один, и за какой период. */
  kit: string
  period: TierPeriod
  setKit: (kit: string) => void
  setPeriod: (p: TierPeriod) => void
  kitRows: Record<string, TierKitRow[]>
  kitAt: Record<string, number>
  stats: Record<string, TierKitStats> | null
  recent: TierRecent[] | null
  /** Сезон и неделя: undefined — не спрашивали, null — API их пока не отдаёт (вкладку прячем). */
  periodRows: Record<string, TierPeriodRow[] | null | undefined>
  loadKit: (kit: string, force?: boolean) => Promise<void>
  loadLive: () => Promise<void>
  loadPeriod: (period: 'season' | 'week', kit: string) => Promise<void>
  /** История матчей по нику: undefined — не спрашивали, null — нет истории. */
  matches: Record<string, TierMatch[] | null | undefined>
  loadMatches: (nick: string, force?: boolean) => Promise<void>
  season: TierSeason | null
  rules: TierRule[]
  loadRules: () => Promise<void>
  nick: string
  /** undefined — ещё не знаем, null — тира нет (сервер ответил 404). */
  me: TierPlayer | null | undefined
  top: TierTopEntry[] | null
  modes: TierModeInfo[]
  failed: boolean
  at: number
  loading: boolean
  load: (nick: string, force?: boolean) => Promise<void>
}

const listOf = <T,>(v: unknown, pick: (x: any) => T[] | undefined = (x) => (Array.isArray(x) ? x : undefined)): T[] | null => pick(v) ?? null

export const useTiers = create<State>((set, get) => ({
  kit: 'all',
  period: 'tier',
  setKit: (kit) => {
    set({ kit })
    const p = get().period
    if (kit !== 'all') void get().loadKit(kit)
    if (p !== 'tier') void get().loadPeriod(p, kit)
  },
  setPeriod: (period) => {
    set({ period })
    if (period !== 'tier') void get().loadPeriod(period, get().kit)
  },
  kitRows: {},
  kitAt: {},
  stats: null,
  recent: null,
  periodRows: {},
  loadKit: async (kit, force = false) => {
    const s = get()
    if (!force && s.kitRows[kit] && Date.now() - (s.kitAt[kit] ?? 0) < FRESH_MS) return
    try {
      const rows = await api<TierKitRow[]>('/tiers/mode/' + encodeURIComponent(kit))
      if (Array.isArray(rows)) set((st) => ({ kitRows: { ...st.kitRows, [kit]: rows }, kitAt: { ...st.kitAt, [kit]: Date.now() } }))
    } catch {}
  },
  loadLive: async () => {
    const [stats, recent] = await Promise.allSettled([api<Record<string, TierKitStats>>('/tiers/stats'), api<TierRecent[]>('/tiers/recent')])
    set((st) => ({
      stats: stats.status === 'fulfilled' && stats.value && typeof stats.value === 'object' ? stats.value : st.stats,
      recent: recent.status === 'fulfilled' && Array.isArray(recent.value) ? recent.value : st.recent,
    }))
  },
  loadPeriod: async (period, kit) => {
    const key = period + ':' + kit
    if (get().periodRows[key] !== undefined) return
    const path = '/tiers/' + period + (kit === 'all' ? '' : '/' + encodeURIComponent(kit))
    try {
      const body = await api<unknown>(path)
      if (period === 'season' && kit === 'all' && body && typeof body === 'object' && Array.isArray((body as TierSeason).divisions)) {
        const b = body as TierSeason
        set({ season: { title: b.title, number: b.number, daysLeft: b.daysLeft, divisions: b.divisions } })
      }
      // Сезон отдаёт { top: [...] }, неделя — массив.
      const rows = listOf<TierPeriodRow>(body, (x) => (Array.isArray(x) ? x : Array.isArray(x?.top) ? x.top : undefined))
      set((st) => ({ periodRows: { ...st.periodRows, [key]: rows } }))
    } catch {
      set((st) => ({ periodRows: { ...st.periodRows, [key]: null } }))
    }
  },
  matches: {},
  loadMatches: async (nick, force = false) => {
    const key = nick.toLowerCase()
    if (!nick || (!force && get().matches[key] !== undefined)) return
    try {
      const body = await api<{ records?: TierMatch[] }>('/tiers/player/' + encodeURIComponent(nick) + '/matches')
      set((st) => ({ matches: { ...st.matches, [key]: Array.isArray(body?.records) ? body.records : [] } }))
    } catch {
      set((st) => ({ matches: { ...st.matches, [key]: null } }))
    }
  },
  season: null,
  rules: [],
  loadRules: async () => {
    if (get().rules.length) return
    try {
      const body = await api<{ tiers?: TierRule[] }>('/tiers/rules')
      if (Array.isArray(body?.tiers)) set({ rules: body.tiers })
    } catch {}
  },
  nick: '',
  me: undefined,
  top: null,
  modes: [],
  failed: false,
  at: 0,
  loading: false,
  load: async (nick, force = false) => {
    const s = get()
    if (s.loading) return
    if (!force && s.nick === nick && s.top && Date.now() - s.at < FRESH_MS) return
    set({ loading: true, failed: false, ...(s.nick !== nick ? { nick, me: undefined } : {}) })
    // Три запроса независимы: медленный общий топ не держит ни свои тиры, ни список китов
    // (12.10.2026: /tiers/overall отвечал 25 с, и весь раздел висел на скелетах).
    const me = (nick
      ? api<TierPlayer>('/tiers/player/' + encodeURIComponent(nick)).catch((e) => (/404|not.?found/i.test(String(e)) ? null : Promise.reject(e)))
      : Promise.resolve(null)
    )
      .then((p) => get().nick === nick && set({ me: p }))
      .catch(() => {})
    const modes = (s.modes.length ? Promise.resolve(s.modes) : api<TierModeInfo[]>('/tiers/modes'))
      .then((m) => Array.isArray(m) && set({ modes: m }))
      .catch(() => {})
    const top = api<TierTopEntry[]>('/tiers/overall')
      .then((t) => Array.isArray(t) && set({ top: t }))
      .catch(() => set((st) => ({ failed: !st.top })))
    await Promise.allSettled([me, modes, top])
    set({ loading: false, at: Date.now() })
  },
}))

/** Название режима для подписи: «Sword», «Diamond SMP». */
export function modeTitle(modes: TierModeInfo[], slug: string): string {
  return modes.find((m) => m.slug === slug)?.title || slug.toUpperCase()
}

/** Следующий тир выше текущего и сколько ELO до него; null — выше некуда или правил нет. */
export function nextTier(rules: TierRule[], tier: string | null, elo: number): { tier: string; need: number; from: number } | null {
  const r = tier ? tierRank(tier) : 15
  if (r === null || !rules.length) return null
  const up = rules
    .filter((x) => tierRank(x.tier) !== null && tierRank(x.tier)! < r)
    .sort((a, b) => tierRank(b.tier)! - tierRank(a.tier)!)[0]
  if (!up) return null
  const cur = tier ? rules.find((x) => x.tier.toUpperCase() === tier.toUpperCase()) : null
  return { tier: up.tier, need: Math.max(0, up.minElo - elo), from: cur?.minElo ?? Math.min(elo, up.minElo - 100) }
}

/** Дивизион сезона по очкам. */
export function divisionOf(season: TierSeason | null, score: number): { name: string; color: string; min: number; next?: { name: string; min: number } } | null {
  if (!season?.divisions?.length) return null
  const sorted = [...season.divisions].sort((a, b) => b.min - a.min)
  const i = sorted.findIndex((d) => score >= d.min)
  if (i < 0) return null
  const d = sorted[i]
  const up = i > 0 ? sorted[i - 1] : undefined
  return { ...d, next: up ? { name: up.name, min: up.min } : undefined }
}
