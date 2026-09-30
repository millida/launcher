import type { ScreenId } from '../state/ui'

/*
 * Где живёт Милли (владелец 30.09.2026): на всех основных экранах — библиотека,
 * «Ресурсы», лобби, серверы, скины, рубины, PLUS и т.д. Нет её только на
 * настройках, в игре и поверх открытой страницы сборки. Поддержка — кнопка-
 * наушники в шапке панели Милли.
 */
const HIDDEN: readonly ScreenId[] = ['game', 'settings']

export function isMilliScreen(screen: ScreenId, _hubAll = false, buildOpen = false): boolean {
  if (buildOpen) return false
  return !HIDDEN.includes(screen)
}
