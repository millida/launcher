import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'

/**
 * Плашка «новое» у раздела. Гаснет не по времени и не по числу запусков, а по
 * тому, что человек ОТКРЫЛ саму новинку: украшения живут внутри вкладки скинов,
 * и по значку на «Скинах» нельзя догадаться, что там появилось. Плашка, которая
 * гаснет от захода в раздел, а не в новинку, врёт: раздел старый, новинка в нём.
 */
const KEY = 'm-seen-cosmetics'

interface NewHintState {
  cosmeticsSeen: boolean
}

export const useNewHint = create<NewHintState>(() => ({
  cosmeticsSeen: readPref(KEY, '') === '1',
}))

export function noteCosmeticsSeen(): void {
  if (useNewHint.getState().cosmeticsSeen) return
  writePref(KEY, '1')
  useNewHint.setState({ cosmeticsSeen: true })
}
