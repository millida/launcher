import type { GiftHistory } from '../lib/gifts'
import { onRealtime, onRealtimeCatchUp } from '../lib/realtime'
import { pushChatNotify } from './chatNotify'
import { getMillidaAccount, useAccounts } from './accounts'
import { showGift, useGifts } from './gifts'
import { useUi } from './ui'
import { t } from '../i18n'

const FIRST_LOAD_DELAY_MS = 4_000
const NAMED_TOASTS_MAX = 2

const announced = new Set<string>()

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
  const offHistory = useGifts.subscribe((st, prev) => {
    if (st.history && st.history !== prev.history) announce(st.history)
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
    offHistory()
    document.removeEventListener('visibilitychange', onVisible)
  }
}
