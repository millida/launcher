import { create } from 'zustand'
import { readPref, writePref } from './prefs'

/**
 * Состояние новогодней темы — отдельно от её логики (lib/festive.ts): этот файл
 * нужен стартовому коду (hosts.tsx решает, качать ли слой), а проверка версии
 * и календарь приходят позже через import() и в стартовый бюджет не входят.
 */

export type FestiveScene = 'winter' | 'newyear'

export const FESTIVE_KEY = 'm-festive'

export interface FestiveState {
  /** Что идёт сейчас, если тема доступна; null — темы нет (обычная сборка вне флага). */
  scene: FestiveScene | null
  /** Выбор игрока в настройках. */
  on: boolean
  setOn: (on: boolean) => void
}

export const useFestive = create<FestiveState>((set) => ({
  scene: null,
  on: readPref(FESTIVE_KEY, '1') !== '0',
  setOn: (on) => {
    writePref(FESTIVE_KEY, on ? '1' : '0')
    set({ on })
  },
}))

/** Тема на экране: доступна и не выключена игроком. */
export const festiveActive = (s: Pick<FestiveState, 'scene' | 'on'>): FestiveScene | null => (s.on ? s.scene : null)
