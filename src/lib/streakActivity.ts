import { api, hasMillidaAccount } from './api'
import { SESSION_MS, mskDay, shouldCountDay } from './retention'
import { useDaily } from '../state/daily'
import { useGame } from '../state/game'

const TICK_MS = 15_000

let focusedSince: number | null = null
let sentDay: number | null = null
let sending = false

const onScreen = () => !document.hidden && document.hasFocus()

async function count(gameStarted: boolean) {
  const now = Date.now()
  if (sending || !hasMillidaAccount() || !shouldCountDay({ now, focusedSince, gameStarted, sentDay })) return
  sending = true
  try {
    await api('/rubies/daily/active', { method: 'POST' })
    sentDay = mskDay(now)
    void useDaily.getState().load()
  } catch (e) {
    // Старая служба ручки не знает и считает день сама — не повторяем.
    if (/\b404\b/.test(String((e as { message?: string } | null)?.message ?? e))) sentDay = mskDay(now)
  } finally {
    sending = false
  }
}

export function initStreakActivity(): () => void {
  const sync = () => {
    if (onScreen()) focusedSince ??= Date.now()
    else focusedSince = null
  }
  sync()
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  document.addEventListener('visibilitychange', sync)
  const tick = window.setInterval(() => {
    sync()
    void count(false)
  }, TICK_MS)
  const first = window.setTimeout(() => void count(false), SESSION_MS + 500)
  let games = useGame.getState().list.length
  const stopGames = useGame.subscribe((s) => {
    if (s.list.length > games) void count(true)
    games = s.list.length
  })
  return () => {
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
    document.removeEventListener('visibilitychange', sync)
    window.clearInterval(tick)
    window.clearTimeout(first)
    stopGames()
  }
}
