import { create } from 'zustand'
import { api } from '../lib/api'
import { setScreen } from './ui'
import { plural } from '../lib/format'

export type Board = 'week' | 'month' | 'all' | 'streak'
export const BOARDS: { key: Board; name: string }[] = [
  { key: 'week', name: 'Неделя' },
  { key: 'month', name: 'Месяц' },
  { key: 'all', name: 'Всё время' },
  { key: 'streak', name: 'Огоньки' },
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
  views: {},
  at: {},
  loading: {},
  failed: {},
  setBoard: (board) => {
    set({ board })
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

/** Открыть экран досок на нужной (огонь серии → «Огоньки», место недели → «Неделя»). */
export function openTop(board: Board) {
  useBoards.getState().setBoard(board)
  setScreen('top')
}

/** Значение строки: «42 ч», «7,5 ч» или дни серии. */
export const boardValueText = (b: Board, v: number): string =>
  b === 'streak' ? v + ' ' + plural(v, 'день', 'дня', 'дней') : (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')) + ' ч'
