import { create } from 'zustand'
import { hasMillidaAccount } from '../lib/api'
import { loadGiftHistory, type GiftHistory, type ReceivedGift } from '../lib/gifts'
import { onRealtime, onRealtimeCatchUp } from '../lib/realtime'
import { pushChatNotify } from './chatNotify'
import { getMillidaAccount, useAccounts } from './accounts'
import { useUi } from './ui'
import { t } from '../i18n'

const FIRST_LOAD_DELAY_MS = 4_000
const NAMED_TOASTS_MAX = 2

interface GiftsState {
  history: GiftHistory | null
  failed: boolean
  opening: string | null
  load: () => Promise<void>
  markOpened: (gift: ReceivedGift) => void
  showGift: (id: string) => void
  hideGift: () => void
}

let seq = 0
const announced = new Set<string>()

export const useGifts = create<GiftsState>((set, get) => ({
  history: null,
  failed: false,
  opening: null,
  load: async () => {
    if (!hasMillidaAccount()) {
      seq += 1
      set({ history: null, failed: false })
      return
    }
    const mine = ++seq
    try {
      const history = await loadGiftHistory()
      if (mine !== seq) return
      set({ history, failed: false })
      announce(history)
    } catch (err) {
      if (mine !== seq) return
      console.warn('[gifts] history', err)
      set({ failed: true })
    }
  },
  markOpened: (gift) => {
    const history = get().history
    if (!history) return
    const received = history.received.map((g) => (g.id === gift.id ? { ...gift, opened: true } : g))
    set({ history: { ...history, received, unopened: received.filter((g) => !g.opened).length } })
  },
  showGift: (id) => set({ opening: id }),
  hideGift: () => set({ opening: null }),
}))

export const showGift = (id: string) => useGifts.getState().showGift(id)

function announce(history: GiftHistory) {
  const fresh = history.received.filter((g) => !g.opened && !announced.has(g.id))
  fresh.forEach((g) => announced.add(g.id))
  if (!fresh.length) return
  if (fresh.length > NAMED_TOASTS_MAX) {
    pushChatNotify({
      uid: 'gifts',
      nick: t('Подарки'),
      text: t('Тебе пришли подарки: {n}', { n: fresh.length }),
      kind: 'gift',
      actionLabel: t('Открыть подарки'),
      action: () => useUi.getState().openSettings('look'),
    })
    return
  }
  fresh.forEach((g) =>
    pushChatNotify({
      uid: 'gift:' + g.id,
      nick: g.from?.nickname || t('Друг'),
      text: t('Дарит тебе подарок'),
      kind: 'gift',
      actionLabel: t('Открыть подарок'),
      action: () => showGift(g.id),
    }),
  )
}

/** Keeps the gift list fresh for the whole session: the server pokes `account` when a gift lands. */
export function initGiftWatch(): () => void {
  let owner = getMillidaAccount()?.id ?? ''
  const refresh = () => void useGifts.getState().load()
  const timer = window.setTimeout(refresh, FIRST_LOAD_DELAY_MS)
  const offPoke = onRealtime('account', refresh)
  const offCatchUp = onRealtimeCatchUp(refresh)
  const offAccounts = useAccounts.subscribe(() => {
    const next = getMillidaAccount()?.id ?? ''
    if (next === owner) return
    owner = next
    announced.clear()
    useGifts.setState({ history: null, opening: null })
    refresh()
  })
  const onVisible = () => {
    if (!document.hidden) refresh()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.clearTimeout(timer)
    offPoke()
    offCatchUp()
    offAccounts()
    document.removeEventListener('visibilitychange', onVisible)
  }
}
