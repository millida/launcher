import { useEffect } from 'react'
import { claimProgress, loadProgress } from './rubies'
import { hasMillidaAccount } from './api'
import { useDaily } from '../state/daily'
import { showToast } from '../state/ui'

const KEY = 'm-hours1-chest'
const CODE = 'hours1'
let asked = false

const settled = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
const settle = () => {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* без хранилища спросим ещё раз при следующем запуске */
  }
}

/**
 * Сундук за первый час игры — обещание экрана первого дня. Как только наиграно
 * больше часа, лаунчер сам забирает его (служба проверит часы по своему учёту)
 * и кладёт в «Мои сундуки». Один раз на компьютер, без повторных запросов.
 */
export function useFirstHourChest(on: boolean, totalSeconds: number) {
  const due = totalSeconds >= 3600
  useEffect(() => {
    if (!on || !due || asked || settled() || !hasMillidaAccount()) return
    asked = true
    void (async () => {
      const list = await loadProgress()
      const item = list?.items?.find((it) => it.code === CODE)
      if (!item) return
      if (item.claimed) return settle()
      if (!item.done) {
        asked = false
        return
      }
      const got = await claimProgress(CODE)
      if (!got.claimed) return
      settle()
      showToast('Сундук за первый час — в «Моих сундуках»', 'ok')
      void useDaily.getState().load()
    })().catch(() => {
      asked = false
    })
  }, [on, due])
}
