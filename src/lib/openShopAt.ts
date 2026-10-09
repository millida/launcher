import { setScreen } from '../state/ui'

/**
 * Сундук дня и пропуск — в магазине, а не отдельным окном (владелец 09.10.2026:
 * окно поверх экрана путало и листалось). Открыть магазин и доехать до раздела.
 */
export function openShopAt(id = 'shop-pass') {
  setScreen('rubies')
  let tries = 0
  const go = () => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (++tries < 20) window.setTimeout(go, 150)
  }
  window.setTimeout(go, 120)
}
