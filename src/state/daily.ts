import { create } from 'zustand'
import {
  claimAllDaily,
  claimDaily,
  freshClientSeed,
  loadChests,
  loadDaily,
  openChest,
  type ChestOpenResult,
  type DailyClaim,
  type PendingChest,
} from '../lib/rubies'
import { api, hasMillidaAccount } from '../lib/api'
import { isPaymentUrl } from '../lib/payHosts'
import { openPaymentUrl } from '../lib/openPayment'
import { MILLIDA_USER_KEY } from './accounts'
import { apiErrorText } from '../lib/apiError'
import { loadPlus, subscribePlus, type PlusStatus } from '../lib/gameProfile'
import { logoutToLogin } from '../lib/session'
import { watchPlusPurchase } from './plusWatch'
import { purchaseFlow } from '../lib/purchaseTrack'
import { trackFailure } from '../lib/telemetry'
import { usePlus } from './plus'
import { showToast } from './ui'
import { passCols, readyCells, seasonal, type ClaimTarget, type DailyView } from '../components/daily/track'
import { demoClaim, forgetDemoChest } from '../components/daily/demoTrack'
import { demoOpen, isTier, RARITY_ORDER } from '../components/daily/chestDrops'
import type { Rarity } from '../lib/rubies'

/**
 * Ежедневный сундук в лобби (как Brawl Pass): одна копия состояния на весь
 * лаунчер, чтобы угол лобби и окно трека не спрашивали службу дважды.
 *
 * Ручки уже есть на службе рубинов: `GET /v2/rubies/daily` и
 * `POST /v2/rubies/daily/claim` (src/lib/rubies.ts). В демо-входе
 * (?preview=user) их подменяет src/lib/demo.ts.
 */
interface DailyState {
  status: DailyView | null
  /** Ответ службы на «Забрать» — окно показывает его анимацией. */
  reveal: DailyClaim | null
  loading: boolean
  failed: boolean
  busy: 'claim' | 'plus' | 'chest' | ''
  /** Что забирается сейчас: клетка или «всё открытое». */
  target: ClaimTarget | null
  modal: boolean
  /** Подписка: цена в копейках и срок — цена стоит рядом с кнопкой, отмена не прячется. */
  plus: PlusStatus | null
  /** Подписка только что открылась: сколько вещей пришло (праздник поверх окна). */
  plusJoy: number | null
  /**
   * Карточка PLUS внутри лаунчера: цена, что даёт, «Оформить». Закрытая
   * клетка PLUS и «Оформить PLUS» открывают её, а не сразу оплату (разбор
   * оплаты 24.09.2026: оплата без цены уронила конверсию с 83% до 49%).
   */
  plusCard: boolean
  /** Ссылка последней неоплаченной подписки: повторное «Оформить» в 15 минут открывает её же. */
  pay: { url: string; at: number } | null

  load: () => Promise<void>
  /** Забрать клетку сезона или всё открытое; без цели — первую открытую. */
  claim: (target?: ClaimTarget) => Promise<void>
  startPlus: () => Promise<void>
  setPlusCard: (open: boolean) => void
  /**
   * Неоткрытые сундуки службы (GET /rubies/chests): за часы игры, промокод,
   * рентген. Старая служба не кладёт их в ответ бонуса, поэтому «Мои сундуки»
   * собирают оба списка (chestList).
   */
  pending: PendingChest[]
  /** Открыть один сундук для окна открытия: ответ или понятная причина отказа. */
  openOne: (id: string) => Promise<ChestOpenAnswer>
  setModal: (open: boolean) => void
  clearReveal: () => void
  endPlusJoy: () => void
}

let seq = 0

export type ChestOpenAnswer =
  | { ok: ChestOpenResult }
  | {
      /** Текст для игрока. */
      error: string
      /** Служба не знает этого сундука или ручки: нужна новая служба, повтор не поможет. */
      outdated?: boolean
    }

/**
 * Демо-сундук (id `demo-chest-*`): его выдала витрина трека в dev-приложении
 * (VITE_DAILY_SHOWCASE), служба о нём не знает. Жалоба владельца 24.09.2026
 * «забрал сундуки, а они не открываются»: такие id уходили на прод и получали
 * 404 «Сундука нет». Теперь открываются на месте тем же броском, что и демо.
 */
const demoChestId = (id: string) => import.meta.env.DEV && id.startsWith('demo-chest-')

/** Все неоткрытые: из бонуса и из службы, без повторов, в порядке выдачи. */
export function chestList(s: { status: DailyView | null; pending: PendingChest[] }): PendingChest[] {
  const seen = new Set<string>()
  const out: PendingChest[] = []
  for (const c of [...(s.status?.chests || []), ...s.pending]) {
    if (!c || seen.has(c.id) || !isTier(c.tier)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

/**
 * Витрина (только dev): VITE_DAILY_SHOWCASE=1 в .env.local. Трек сезона на
 * демо-вещах, «Забрать» не ходит в службу: забранные клетки запоминаются до
 * перезагрузки (demoTrack.ts), чтобы можно было прокликать весь пасс, не
 * трогая живой аккаунт. В релизе `import.meta.env.DEV` — константа false,
 * и ветка вырезается сборкой.
 */
const SHOWCASE = import.meta.env.DEV && import.meta.env.VITE_DAILY_SHOWCASE === '1'

/**
 * Пока служба не отдаёт сезон, витрина показывает сезон на живых вещах
 * каталога (тот же, что в демо-входе), сохраняя подписку.
 */
async function showcaseTrack(s: DailyView): Promise<DailyView> {
  if (!SHOWCASE || seasonal(s)) return s
  const { demoStatus, liveItems } = await import('../components/daily/demoTrack')
  const cat = await api<{ items?: { id: string; name: string; preview?: string | null }[] }>('/cosmetics/catalog').catch(
    () => null,
  )
  return demoStatus({ items: liveItems(cat && cat.items), plus: !!s.plus })
}

let stopWatch: (() => void) | null = null

/** Ссылка на оплату шлюза живёт 15 минут — столько же её и переиспользуем. */
const PAY_TTL = 15 * 60_000
/// Ссылка привязана к аккаунту Millida: после смены аккаунта на том же
/// компьютере чужая неоплаченная ссылка не открывается (аудит 24.09.2026).
const payKey = (): string | null => {
  const uid = localStorage.getItem(MILLIDA_USER_KEY)
  return uid ? 'm-plus-pay:' + uid : null
}

function savedPay(): { url: string; at: number } | null {
  try {
    localStorage.removeItem('m-plus-pay')
    const key = payKey()
    if (!key) return null
    const v = JSON.parse(localStorage.getItem(key) || 'null') as { url?: unknown; at?: unknown } | null
    if (v && typeof v.url === 'string' && isPaymentUrl(v.url) && typeof v.at === 'number' && Date.now() - v.at < PAY_TTL)
      return { url: v.url, at: v.at }
  } catch {
    /* хранилище недоступно — просто без запоминания */
  }
  return null
}

function keepPay(pay: { url: string; at: number } | null) {
  try {
    const key = payKey()
    if (!key) return
    if (pay) localStorage.setItem(key, JSON.stringify(pay))
    else localStorage.removeItem(key)
  } catch {
    /* см. savedPay */
  }
}

export const useDaily = create<DailyState>((set, get) => ({
  status: null,
  reveal: null,
  loading: false,
  failed: false,
  busy: '',
  target: null,
  modal: false,
  plus: null,
  plusJoy: null,
  plusCard: false,
  pay: savedPay(),
  pending: [],

  load: async () => {
    // Идёт «Забрать»: его ответ свежее, чем то, что вернёт этот запрос.
    if (get().busy === 'claim') return
    const mine = ++seq
    if (!hasMillidaAccount()) {
      set({ status: null, loading: false, failed: false })
      return
    }
    set({ loading: !get().status, failed: false })
    loadPlus()
      .then((plus) => {
        if (mine === seq) set({ plus })
      })
      .catch(() => undefined)
    loadChests()
      .then((c) => {
        if (mine === seq) set({ pending: Array.isArray(c?.pending) ? c.pending : [] })
      })
      .catch(() => undefined)
    try {
      const status = await showcaseTrack(await loadDaily())
      if (mine !== seq) return
      set({ status, loading: false })
    } catch {
      if (mine !== seq) return
      set({ loading: false, failed: !get().status })
    }
  },

  claim: async (want) => {
    if (get().busy) return
    if (!hasMillidaAccount()) {
      logoutToLogin()
      return
    }
    const cur = get().status
    const cells = readyCells(passCols(cur, !!cur?.plus))
    const target: ClaimTarget | null = want ?? cells[0] ?? null
    if (!target || !cur) return
    seq++
    set({ busy: 'claim', reveal: null, target })
    if (SHOWCASE && cur.track?.length) {
      await new Promise((r) => setTimeout(r, 450))
      const res = demoClaim(cur, 0, target)
      set({ status: res, reveal: res, busy: '' })
      return
    }
    try {
      // Старая служба знает только «забрать сегодня» — обе строки разом.
      const res = !seasonal(cur)
        ? await claimDaily()
        : target === 'all'
          ? await claimAllDaily()
          : await claimDaily(target)
      seq++
      set({ status: res, reveal: res })
    } catch (e) {
      trackFailure('daily_claim', e)
      showToast(apiErrorText(e, 'Служба рубинов не ответила, попробуй позже'), 'error')
    } finally {
      set({ busy: '' })
    }
  },

  /** Тот же путь, что у кнопок PLUS в магазине и на «Персонаже». */
  startPlus: async () => {
    if (!hasMillidaAccount()) {
      logoutToLogin()
      return
    }
    // Свежая неоплаченная ссылка — та же: новая подписка на каждый клик
    // плодила «ожидает оплаты» (разбор 24.09.2026).
    const fresh = get().pay && savedPay()
    if (fresh && Date.now() - fresh.at < PAY_TTL) {
      openPaymentUrl(fresh.url)
      return
    }
    set({ busy: 'plus' })
    // Воронка PLUS: исход — только настоящая оплата (её ловит опрос ниже) или ошибка.
    const result = purchaseFlow('plus', 'plus')
    try {
      const started = await subscribePlus()
      const pay = { url: started.paymentUrl, at: Date.now() }
      keepPay(pay)
      set({ pay })
      openPaymentUrl(started.paymentUrl)
      stopWatch?.()
      stopWatch = watchPlusPurchase((status) => {
        result(true)
        usePlus.getState().setActive(status.active)
        keepPay(null)
        set({ plus: status, plusJoy: status.items || 0, pay: null, plusCard: false })
        void get().load()
      })
    } catch (e) {
      result(false, 'error', e)
      showToast(apiErrorText(e, 'Не удалось оформить подписку'), 'error')
    } finally {
      set({ busy: '' })
    }
  },

  setPlusCard: (open) => set({ plusCard: open }),

  openOne: async (id) => {
    if (!hasMillidaAccount()) {
      logoutToLogin()
      return { error: 'Войди в аккаунт Millida' }
    }
    const drop = () => {
      const cur = get().status
      set({
        pending: get().pending.filter((c) => c.id !== id),
        ...(cur ? { status: { ...cur, chests: (cur.chests || []).filter((c) => c.id !== id) } } : {}),
      })
    }
    try {
      let res: ChestOpenResult
      if (demoChestId(id)) {
        const tier = chestList(get()).find((c) => c.id === id)?.tier
        await new Promise((r) => setTimeout(r, 250))
        const force = new URLSearchParams(location.search).get('chest-top')
        res = demoOpen(
          id,
          tier && isTier(tier) ? tier : 'COMMON',
          force && RARITY_ORDER.includes(force as Rarity) ? (force as Rarity) : null,
          new URLSearchParams(location.search).has('chest-whole'),
        )
        forgetDemoChest(id)
      } else {
        res = await openChest(id, freshClientSeed())
      }
      drop()
      return { ok: res }
    } catch (e) {
      const raw = String((e as { message?: string } | null)?.message ?? e)
      // 404: ручки нет (старая служба) или служба не знает сундук; 400 «уже открыт».
      if (/already|уже открыт/i.test(raw)) {
        drop()
        return { error: 'Этот сундук уже открыт' }
      }
      // «Сундука нет» — служба не знает этот id (уже открыт в другом окне или
      // пропал): это не «старая служба», убираем его из списка.
      if (/сундука нет/i.test(raw)) {
        drop()
        return { error: 'Этого сундука уже нет' }
      }
      if (/\b404\b|not found|cannot post/i.test(raw))
        return { error: 'Откроется после обновления Millida', outdated: true }
      trackFailure('chest_open', e)
      return { error: apiErrorText(e, 'Сундук не открылся, попробуй ещё раз') }
    }
  },

  setModal: (open) => set(open ? { modal: true } : { modal: false, reveal: null, target: null }),
  clearReveal: () => set({ reveal: null }),
  endPlusJoy: () => set({ plusJoy: null }),
}))

/** Есть ли что забрать прямо сейчас (хоть одна открытая клетка). */
export const dailyReady = (s: DailyView | null): boolean =>
  !!s && (seasonal(s) ? readyCells(passCols(s, !!s.plus)).length > 0 : !s.claimedToday)
