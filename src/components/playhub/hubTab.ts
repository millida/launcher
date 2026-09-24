import { create } from 'zustand'
import { setScreen } from '../../state/ui'
import { useMods } from '../../state/mods'

/**
 * Экран «Во что играем», версия 5 (владелец 24.09.2026, 16:09): одна страница
 * без вкладок — Мои сборки → Для тебя (свой сервер, Arcania Labs, OneBlock,
 * карты, сборки) → Сборки → Режимы → Зайти на сервер. «server»/«try» ведут
 * к «Для тебя». Весь каталог (сборки, моды, паки, шейдеры, карты, поиск,
 * фильтры) — страница «Все» поверх хаба, как каталог millida.net.
 *
 * `tab` остался для старых входов: «builds» — прокрутка к «Моим сборкам»,
 * «catalog» — верх страницы. Хаб всегда открывается сверху.
 */
export type HubTab = 'catalog' | 'builds'
/** Раздел, к которому прокрутить при входе снаружи («add» — полный каталог с модами). */
export type HubSection = 'server' | 'try' | 'builds' | 'foryou' | 'packs' | 'modes' | 'servers' | 'add'

interface HubTabState {
  tab: HubTab
  /** Открыта страница «Все» (полный каталог). */
  all: boolean
  /** К какому разделу прокрутить при следующем показе. */
  section: HubSection | null
  /** Растёт при каждом входе в каталог снаружи: каталог по нему перечитывает выдачу. */
  seq: number
  setTab: (t: HubTab) => void
  setAll: (v: boolean) => void
  /** Хаб закрыли — следующий заход снова сверху. */
  reset: () => void
}

export const useHubTab = create<HubTabState>((set) => ({
  tab: 'catalog',
  all: false,
  section: null,
  seq: 0,
  setTab: (t) => set({ tab: t, all: false, section: t === 'builds' ? 'builds' : null }),
  setAll: (v) => set({ all: v }),
  reset: () => set({ tab: 'catalog', all: false, section: null }),
}))

/**
 * Вход в каталог снаружи: «Добавить» в сборке, «Карты» в лобби, старый
 * `setScreen('mods')` — полный каталог на том разделе, что выставили
 * перед переходом (сборки, моды, паки, шейдеры, карты).
 */
export function openHubBuild(modTab?: string) {
  if (modTab) useMods.getState().set({ modTab, fCats: [], fCat: 'все', count: '' })
  useHubTab.setState((s) => ({ tab: 'catalog', all: true, section: null, seq: s.seq + 1 }))
  setScreen('playhub')
}

/** Открыть хаб снаружи на нужном разделе страницы. */
export function openHubTab(t: HubTab | HubSection) {
  if (t === 'add') {
    openHubBuild()
    return
  }
  const section: HubSection | null = t === 'catalog' ? null : t
  useHubTab.setState({ tab: t === 'builds' ? 'builds' : 'catalog', all: false, section })
  setScreen('playhub')
}
