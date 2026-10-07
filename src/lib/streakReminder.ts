import { hasTauri } from '../ipc/tauri'
import { hasMillidaAccount } from './api'
import { showDesktopToast } from './desktopToast'
import { REMIND_BEFORE_MS, keepWeek, reminderDue, toMskMidnight } from './retention'
import { dailyReady, useDaily } from '../state/daily'
import { daysWord } from '../components/daily/track'

const ON_KEY = 'm-streak-remind'
const LOG_KEY = 'm-streak-remind-log'
const TICK_MS = 5 * 60_000

/** Тумблер «Напоминать о серии» в «Настройках»; по умолчанию включён. */
export function streakRemindOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) !== '0'
  } catch {
    return true
  }
}

export function setStreakRemind(on: boolean) {
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0')
  } catch {
    /* без хранилища тумблер живёт до перезапуска */
  }
}

function readLog(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || '[]')
    return Array.isArray(v) ? v.filter((t): t is number => typeof t === 'number') : []
  } catch {
    return []
  }
}

function writeLog(log: number[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log))
  } catch {
    /* журнал не сохранится — лимит держится до перезапуска */
  }
}

let inFlight = false

async function check() {
  const now = Date.now()
  if (inFlight || !streakRemindOn() || !hasMillidaAccount()) return
  // До окна напоминания службу не спрашиваем: лаунчер в трее не дёргает её зря.
  if (toMskMidnight(now) > REMIND_BEFORE_MS) return
  inFlight = true
  try {
    const log = keepWeek(readLog(), now)
    if (!reminderDue({ now, ready: true, enabled: true, shown: log })) return
    await useDaily.getState().load()
    const status = useDaily.getState().status
    // Серии грозит только день без захода: окно не открывали и не играли.
    // Старая служба поля не шлёт — тогда ориентир «бонус не забран».
    const atRisk = status ? (status.activeToday === undefined ? dailyReady(status) : !status.activeToday) : false
    if (!status || status.streak < 1 || !reminderDue({ now, ready: atRisk, enabled: streakRemindOn(), shown: log })) return
    const hours = Math.max(1, Math.ceil(toMskMidnight(now) / 3_600_000))
    const shield = (status.shields ?? 0) > 0
    const shown = showDesktopToast({
      uid: 'streak',
      nick: 'Серия ' + daysWord(status.streak),
      text: shield ? 'Иначе уйдёт щит' : 'Сгорит через ' + hours + ' ч',
      ts: now,
      kind: 'streak',
      open: 'daily',
    })
    if (shown) writeLog([...log, now])
  } finally {
    inFlight = false
  }
}

/**
 * «Серия сгорит»: за 3 часа до полуночи по Москве, если бонус дня не забран,
 * карточка поверх рабочего стола или игры (не системный пуш). Не чаще раза в
 * сутки и трёх раз в неделю (ресёрч 06.10.2026: больше — отключают).
 * Открытый лаунчер карточку не показывает: там и так видно «Забрать сундук».
 */
export function initStreakReminder(): () => void {
  if (!hasTauri()) return () => {}
  const id = window.setInterval(() => void check().catch(() => {}), TICK_MS)
  const first = window.setTimeout(() => void check().catch(() => {}), 60_000)
  return () => {
    window.clearInterval(id)
    window.clearTimeout(first)
  }
}
