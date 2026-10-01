import type { ScreenId } from '../state/ui'

/*
 * Где живёт Милли (владелец 30.09.2026): только в каталоге — вкладка «Ресурсы»
 * хаба (полный каталог и карточки материалов в нём) и старый экран каталога
 * `mods`. На остальных экранах в углу обычная кнопка поддержки. Открытая
 * страница сборки лежит поверх экрана — там тоже поддержка.
 */
export function isMilliScreen(screen: ScreenId, hubAll: boolean, buildOpen = false): boolean {
  if (buildOpen) return false
  return screen === 'mods' || (screen === 'playhub' && hubAll)
}
