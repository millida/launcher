import { formatDate, t } from '../i18n'
import { useDaily } from '../state/daily'
import { showToast } from '../state/ui'
import { hasMillidaAccount } from './api'
import { plusCheckout, quoteText } from './money'
import { plusReminderDue, plusReminderKey, plusRenews } from './plusRenewal'
import { loadMoney, plusPrice, plusQuote, useMoneyStore } from './useMoney'

const SHOWN_KEY = 'm-plus-remind'
const TICK_MS = 30 * 60_000

function readShown(): string | null {
  try {
    return localStorage.getItem(SHOWN_KEY)
  } catch {
    return null
  }
}

function writeShown(key: string) {
  try {
    localStorage.setItem(SHOWN_KEY, key)
  } catch {
    return
  }
}

function check(now = Date.now()) {
  const plus = useDaily.getState().plus
  if (!plus || !plus.paidUntil || !hasMillidaAccount()) return
  const tier = plus.tier ?? 'PLUS'
  const renews = plusRenews(plus, plusCheckout(plusQuote(tier), plus.quote))
  const due = plusReminderDue({ active: plus.active, paidUntil: plus.paidUntil, renews, now })
  if (!due) return
  const key = plusReminderKey(plus.paidUntil, due.stage)
  if (readShown() === key) return
  const price = plusPrice(tier) ?? (tier === 'PLUS' ? quoteText(plus.quote) : null)
  if (!price) {
    const money = useMoneyStore.getState()
    if (!money.prices && !money.loading) void loadMoney()
    return
  }
  const name = tier === 'DIAMOND' ? 'PLUS Diamond' : 'PLUS'
  const text =
    due.stage === 'today'
      ? t('{name} заканчивается сегодня', { name })
      : t('{name} закончится {date}', { name, date: formatDate(due.endsAt, { day: 'numeric', month: 'long' }) })
  writeShown(key)
  showToast(text, 'ok', undefined, {
    label: t('Продлить за {price}', { price }),
    run: () => void useDaily.getState().startPlus(tier),
  })
}

/**
 * A month bought from the balance never renews by itself, so the player hears about the end
 * three days ahead and on the last day, once each, with the price to renew at in their own currency.
 */
export function initPlusReminder(): () => void {
  const offPlus = useDaily.subscribe((s, was) => {
    if (s.plus !== was.plus) check()
  })
  const offMoney = useMoneyStore.subscribe((s, was) => {
    if (s.prices !== was.prices) check()
  })
  const id = window.setInterval(() => check(), TICK_MS)
  return () => {
    offPlus()
    offMoney()
    window.clearInterval(id)
  }
}
