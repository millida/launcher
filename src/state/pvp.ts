import { create } from 'zustand'
import { setScreen, showToast } from './ui'
import { api } from '../lib/api'
import { quickJoin } from '../lib/joinServer'
import { TIER_SERVER } from './tiers'

/**
 * Раздел PvP — отдельный режим лаунчера, как MCPVP у Dawn (владелец
 * 12.10.2026: «PvP не должен быть просто внутри ивента», «всё на одном
 * экране, без переключения по разделам»): киты и «Играть», тир-лист со
 * своим местом и свои матчи.
 */
/** Старые входы звали вкладку — теперь всё на одном экране, вкладок нет. */
export type PvpTab = 'play' | 'tiers' | 'matches'
export type PvpView = 'home' | 'tiers' | 'matches'

const KIT_KEY = 'm-pvp-kit'
const savedKit = () => {
  try {
    return localStorage.getItem(KIT_KEY) || 'sword'
  } catch {
    return 'sword'
  }
}

interface PvpState {
  /** Выбранный кит: его карточка, кнопка «Играть» и топ справа. */
  kit: string
  setKit: (k: string) => void
  /** Что в панели справа: общий тир-лист или топ выбранного кита. */
  board: 'all' | 'kit'
  setBoard: (b: 'all' | 'kit') => void
  /** Главная раздела или подстраница «все места» / «все матчи» (возврат — «Назад»). */
  view: PvpView
  setView: (v: PvpView) => void
  /** Счётчик нажатий «Случайный»: кнопка стоит у «Играть», а крутит карусель. */
  rollSeq: number
  roll: () => void
}

export const usePvp = create<PvpState>((set) => ({
  kit: savedKit(),
  setKit: (kit) => {
    try {
      localStorage.setItem(KIT_KEY, kit)
    } catch {}
    set({ kit })
  },
  board: 'all',
  setBoard: (board) => set({ board }),
  view: 'home',
  setView: (view) => set({ view }),
  rollSeq: 0,
  roll: () => set((s) => ({ rollSeq: s.rollSeq + 1 })),
}))

/** Открыть раздел PvP (один экран: киты и «Играть», тир-лист, свои матчи). */
export function openPvp(tab?: PvpTab) {
  usePvp.setState({ view: tab === 'tiers' ? 'tiers' : tab === 'matches' ? 'matches' : 'home' })
  setScreen('pvp')
}

/**
 * Очередь из лаунчера, как у MCPVP: игра не запущена, лаунчер стоит в очереди
 * и шлёт «я тут» раз в 10 с; сервер нашёл соперника — лаунчер выходит из
 * очереди и сразу запускает игру прямо в матч. Контракт сервера тиров
 * (Millida SMP, 12.10.2026): POST/DELETE /tiers/queue, GET /tiers/state/<uuid>
 * с phase queued | matched. Живёт вне экрана — очередь не теряется, если
 * уйти из раздела.
 */
export type QueuePhase = 'idle' | 'queued' | 'matched' | 'joining'

interface QueueState {
  phase: QueuePhase
  kit: string
  ranked: boolean
  /** Когда встали в очередь (наши часы). */
  since: number
  /** Сколько человек в очереди кита — со слов сервера. */
  waiting: number | null
  opponent: { name: string; tier?: string } | null
  /** До какого момента надо войти в матч (наши часы). */
  joinBy: number | null
  start: (o: { kit: string; ranked: boolean; uuid: string }) => Promise<'queued' | 'unsupported' | 'error'>
  cancel: () => Promise<void>
}

const HEARTBEAT_MS = 10_000
const POLL_MS = 2_000
let heartbeat: number | undefined
let poll: number | undefined
const stopTimers = () => {
  window.clearInterval(heartbeat)
  window.clearInterval(poll)
  heartbeat = poll = undefined
}

interface StateReply {
  phase?: string
  state?: string
  kit?: string
  since?: number
  waiting?: number
  opponent?: { name?: string; tier?: string }
  joinBy?: number
  /** Куда входить (сервер отдаёт адрес матча). */
  ip?: string
  server?: string
}

export const usePvpQueue = create<QueueState>((set, get) => ({
  phase: 'idle',
  kit: '',
  ranked: true,
  since: 0,
  waiting: null,
  opponent: null,
  joinBy: null,
  start: async ({ kit, ranked, uuid }) => {
    const body = JSON.stringify({ kit, ranked })
    try {
      await api('/tiers/queue', { method: 'POST', body })
    } catch (e) {
      // Сервер ещё без очереди из лаунчера — старый путь: заявка и вход в лобби.
      return /\b(404|405|501)\b|cannot post|not found/i.test(String(e)) ? 'unsupported' : 'error'
    }
    stopTimers()
    set({ phase: 'queued', kit, ranked, since: Date.now(), waiting: null, opponent: null, joinBy: null })
    heartbeat = window.setInterval(() => void api('/tiers/queue', { method: 'POST', body }).catch(() => {}), HEARTBEAT_MS)
    let pending = false
    const tick = () => {
      if (get().phase !== 'queued' || pending) return
      pending = true
      api<StateReply>('/tiers/state/' + encodeURIComponent(uuid))
        .then((r) => {
          if (!r || get().phase !== 'queued') return
          if (r.phase === 'queued') {
            set({ waiting: typeof r.waiting === 'number' ? r.waiting : get().waiting })
          } else if (r.phase === 'matched' && r.opponent?.name) {
            stopTimers()
            void api('/tiers/queue', { method: 'DELETE' }).catch(() => {})
            // joinBy — срок в мс: либо отметка времени, либо сколько осталось.
            const by = typeof r.joinBy === 'number' ? (r.joinBy > 1e12 ? r.joinBy : Date.now() + r.joinBy) : Date.now() + 60_000
            set({ phase: 'matched', opponent: { name: r.opponent.name, tier: r.opponent.tier }, joinBy: by })
            void joinMatch(r.ip, r.server)
          }
        })
        .catch(() => {})
        .finally(() => {
          pending = false
        })
    }
    poll = window.setInterval(tick, POLL_MS)
    tick()
    return 'queued'
  },
  cancel: async () => {
    stopTimers()
    const was = get().phase
    set({ phase: 'idle', opponent: null, joinBy: null, waiting: null })
    if (was === 'queued') await api('/tiers/queue', { method: 'DELETE' }).catch(() => {})
  },
}))

/** Соперник найден: запускаем игру сразу на сервер — он ставит обоих в матч без лобби. */
async function joinMatch(ip?: string, name?: string) {
  usePvpQueue.setState({ phase: 'joining' })
  try {
    await quickJoin(ip || TIER_SERVER.ip, name || TIER_SERVER.name, false, TIER_SERVER.versions)
  } catch {
    showToast('Игра не запустилась — соперник вернётся в очередь', 'error')
  } finally {
    // Дальше статус ведёт сервер (бой, лобби); кнопка снова доступна через минуту.
    window.setTimeout(() => {
      if (usePvpQueue.getState().phase === 'joining') usePvpQueue.setState({ phase: 'idle', opponent: null, joinBy: null })
    }, 60_000)
  }
}
