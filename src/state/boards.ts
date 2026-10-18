import { create } from 'zustand'
import { api } from '../lib/api'
import { setScreen } from './ui'
import { plural } from '../lib/format'
import { formatFixed, t } from '../i18n'
import { TIERS_SECTION_PUBLIC } from '../lib/tiersSection'

export type Board = 'week' | 'month' | 'all' | 'streak'
export const BOARDS: { key: Board; readonly name: string }[] = [
  { key: 'week', get name() { return t('Неделя') } },
  { key: 'month', get name() { return t('Месяц') } },
  { key: 'all', get name() { return t('Всё время') } },
  { key: 'streak', get name() { return t('Огоньки') } },
]

/** Место на доске: только ник, голова, значение (часы или дни), лайки и «друг ли». */
export interface BoardEntry {
  rank: number
  nick: string
  /** Ссылка профиля /u/<slug> — по ней ставится лайк; нет профиля — null. */
  slug: string | null
  head: string | null
  value: number
  likes: number
  isFriend: boolean
}

export interface BoardView {
  board: Board
  from: string | null
  to: string | null
  updatedAt: string
  items: BoardEntry[]
  me: BoardEntry | null
  friends: BoardEntry[]
}

/** Служба пересчитывает доски раз в 5 минут — чаще спрашивать незачем. */
const FRESH_MS = 5 * 60_000

interface State {
  board: Board
  /** Вкладка «PvP-тир» поверх досок: свои данные, не /launcher/top (11.10.2026). */
  tiers: boolean
  setTiers: (on: boolean) => void
  views: Partial<Record<Board, BoardView>>
  at: Partial<Record<Board, number>>
  loading: Partial<Record<Board, boolean>>
  failed: Partial<Record<Board, boolean>>
  setBoard: (b: Board) => void
  load: (b: Board, force?: boolean) => Promise<void>
  /** Лайк поставлен: число на всех досках, где есть этот игрок. */
  bumpLikes: (slug: string, likes: number) => void
}

export const useBoards = create<State>((set, get) => ({
  board: 'week',
  // Тир-лист — главный топ (владелец 11.10.2026), часы и огоньки — фоном.
  tiers: TIERS_SECTION_PUBLIC,
  setTiers: (tiers) => set({ tiers }),
  views: {},
  at: {},
  loading: {},
  failed: {},
  setBoard: (board) => {
    set({ board, tiers: false })
    void get().load(board)
  },
  load: async (b, force = false) => {
    const s = get()
    if (s.loading[b]) return
    if (!force && s.views[b] && Date.now() - (s.at[b] ?? 0) < FRESH_MS) return
    set({ loading: { ...s.loading, [b]: true }, failed: { ...s.failed, [b]: false } })
    try {
      const view = await api<BoardView>('/launcher/top?board=' + b)
      set((st) => ({ views: { ...st.views, [b]: view }, at: { ...st.at, [b]: Date.now() }, loading: { ...st.loading, [b]: false } }))
    } catch {
      set((st) => ({ loading: { ...st.loading, [b]: false }, failed: { ...st.failed, [b]: !st.views[b] } }))
    }
  },
  bumpLikes: (slug, likes) =>
    set((st) => {
      const fix = (e: BoardEntry): BoardEntry => (e.slug === slug ? { ...e, likes } : e)
      const views: State['views'] = {}
      for (const [k, v] of Object.entries(st.views) as [Board, BoardView][])
        views[k] = { ...v, items: v.items.map(fix), friends: v.friends.map(fix), me: v.me ? fix(v.me) : null }
      return { views }
    }),
}))

/** Открыть экран досок на нужной (огонь серии → «Огоньки», место недели → «Неделя», тир → «PvP-тир»). */
export function openTop(board: Board | 'tiers') {
  if (board === 'tiers') useBoards.getState().setTiers(TIERS_SECTION_PUBLIC)
  else useBoards.getState().setBoard(board)
  setScreen('top')
}

/** Значение строки: «42 ч», «7,5 ч» или дни серии. */
export const boardValueText = (b: Board, v: number): string =>
  b === 'streak'
    ? plural(v, t('{n} день', { n: v }), t('{n} дня', { n: v }), t('{n} дней', { n: v }))
    : t('{h} ч', { h: Number.isInteger(v) ? String(v) : formatFixed(v, 1) })
