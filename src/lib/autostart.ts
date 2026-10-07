import { autostartSet, autostartState } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

/** Спрашивали ли уже: включаем по умолчанию один раз, дальше решает человек. */
const ASKED_KEY = 'm-autostart'

const asked = (): boolean => {
  try {
    return localStorage.getItem(ASKED_KEY) !== null
  } catch {
    return true
  }
}

const remember = (on: boolean) => {
  try {
    localStorage.setItem(ASKED_KEY, on ? '1' : '0')
  } catch {
    /* без хранилища включим ещё раз — вреда нет */
  }
}

/**
 * Запуск вместе с системой включён по умолчанию (владелец 06.10.2026): лаунчер
 * в трее показывает таймер сундука и напоминание о серии. Один раз при первом
 * запуске; выключенное человеком больше не включаем.
 */
export async function initAutostart(): Promise<void> {
  if (!hasTauri() || asked()) return
  try {
    remember(await autostartSet(true))
  } catch {
    /* система не дала — останется выключенным, тумблер в «Настройках» покажет */
  }
}

export async function autostartOn(): Promise<boolean> {
  if (!hasTauri()) return false
  return autostartState().catch(() => false)
}

export async function setAutostart(on: boolean): Promise<boolean> {
  const got = await autostartSet(on)
  remember(got)
  return got
}
