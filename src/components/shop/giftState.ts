import { useEffect } from 'react'
import { create } from 'zustand'
import { hasMillidaAccount } from '../../lib/api'
import { loadShopDay, type ItemRef, type ShopDay, type ShopGift } from '../../lib/rubies'
import { setScreen, showToast } from '../../state/ui'
import { freshWishes, markWishSeen, wishedInShop } from './wish'

/**
 * Что в магазине ждёт игрока — для «!» на кнопке «Магазин».
 *
 * 23.09.2026, 21:43: подарок дня заменён ежедневным бонусом (он живёт в
 * state/daily.ts, его «!» плитка лобби берёт оттуда). Здесь осталось:
 * - вещь из «Хочу» появилась на витрине — тост один раз и «!», пока магазин
 *   не открыт (правка владельца 21:45);
 * - старый подарок дня, если старая служба его ещё шлёт.
 *
 * Экран магазина кладёт сюда свежий день после загрузки; если магазин ещё не
 * открывали, хук сам один раз спросит /rubies/shop и ещё раз — в смену дня.
 */
/** Вкладки магазина (правка владельца 21:45: «слипся весь — на разделы»). */
export type ShopTab = 'today' | 'you' | 'progress' | 'rubies' | 'wish'

interface GiftState {
  /** Открытая вкладка магазина: её можно переключить снаружи (тост «Хочу»). */
  tab: ShopTab
  setTab: (tab: ShopTab) => void
  gift: ShopGift | null
  known: boolean
  /** Вещи из «Хочу», которые сегодня на витрине и ещё не показаны. */
  wishNew: ItemRef[]
  setGift: (gift: ShopGift | null | undefined) => void
  /** Новый ответ магазина дня: подарок и «Хочу» на витрине. */
  setDay: (day: ShopDay) => void
  /** Магазин открыт — вещи из «Хочу» показаны, «!» гаснет. */
  seeWishes: (day: ShopDay) => void
}

const toasted = new Set<string>()

export const useShopGift = create<GiftState>((set) => ({
  tab: 'today',
  setTab: (tab) => set({ tab }),
  gift: null,
  known: false,
  wishNew: [],
  setGift: (gift) => set({ gift: gift ?? null, known: true }),
  setDay: (day) => {
    const fresh = freshWishes(day)
    const loud = fresh.filter((it) => !toasted.has(it.code))
    loud.forEach((it) => toasted.add(it.code))
    if (loud.length) showToast('Из «Хочу» на витрине: ' + loud.map((it) => it.name).join(', '), 'ok', undefined, {
        label: 'Смотреть',
        run: () => {
          set({ tab: 'wish' })
          setScreen('rubies')
        },
      })
    set({ gift: day.gift ?? null, known: true, wishNew: fresh })
  },
  seeWishes: (day) => {
    markWishSeen(day.day.refreshAt, wishedInShop(day).map((it) => it.code))
    set({ wishNew: [] })
  },
}))

let asking: Promise<void> | null = null
let dayTimer = 0

function ask() {
  if (asking || !hasMillidaAccount()) return
  asking = loadShopDay()
    .then((d) => useShopGift.getState().setDay(d))
    .catch(() => undefined)
    .finally(() => {
      asking = null
    })
}

/** Когда наступит новый день магазина — спросить заново (не таймер на экране, а одна проверка). */
function scheduleNextDay(gift: ShopGift | null) {
  window.clearTimeout(dayTimer)
  if (!gift) return
  const wait = new Date(gift.refreshAt).getTime() - Date.now()
  if (wait > 0 && wait < 2 * 86_400_000) dayTimer = window.setTimeout(ask, wait + 5_000)
}
useShopGift.subscribe((st, prev) => {
  if (st.gift !== prev.gift) scheduleNextDay(st.gift)
})

/**
 * В магазине что-то ждёт: вещь из «Хочу» на витрине или незабранный старый
 * подарок. Ежедневный бонус плитка лобби проверяет сама (`dailyReady`).
 */
export function useShopGiftReady(): boolean {
  const known = useShopGift((st) => st.known)
  const ready = useShopGift((st) => (!!st.gift && !st.gift.claimed) || st.wishNew.length > 0)
  useEffect(() => {
    if (!known) ask()
  }, [known])
  return ready
}
