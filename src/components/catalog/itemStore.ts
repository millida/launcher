import { create } from 'zustand'
import type { CuratedItem, SiteCard, SkinTile } from './site'

/*
 * Открытая страница материала. Одна на каталог: лента под ней остаётся на
 * месте (фильтры, поиск, подгруженные страницы), «Назад» возвращает прокрутку.
 */

export type OpenItem =
  | { kind: 'card'; section: string; card: SiteCard }
  | { kind: 'cheat'; item: CuratedItem }
  | { kind: 'skin'; skin: SkinTile }

interface ItemState {
  cur: OpenItem | null
  /** Прокрутка ленты до входа — вернуть её по «Назад». */
  scroll: number
  open: (it: OpenItem) => void
  close: () => void
}

/** Ближайший предок, который листается (`.content` у экранов лаунчера). */
export function scroller(el: Element | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    const s = getComputedStyle(n)
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n as HTMLElement
  }
  return (document.scrollingElement as HTMLElement) || null
}

const catalogRoot = () => document.querySelector('.mr-cat')

export const useItem = create<ItemState>((set, get) => ({
  cur: null,
  scroll: 0,
  open: (it) => {
    const sc = scroller(catalogRoot())
    // Из страницы в страницу («Похожие») прокрутку ленты не перетираем.
    const scroll = get().cur ? get().scroll : sc ? sc.scrollTop : 0
    set({ cur: it, scroll })
    requestAnimationFrame(() => {
      const s = scroller(catalogRoot())
      if (s) s.scrollTop = 0
    })
  },
  close: () => {
    // Страницы не было — прокрутку не трогаем. Раньше «закрыть» при каждой смене вкладки
    // возвращало старую прокрутку ленты, и вкладка открывалась где-то внизу (владелец 10.10.2026).
    if (!get().cur) return
    const y = get().scroll
    set({ cur: null })
    // Лента снова видна со следующего кадра — тогда её высота уже настоящая.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const s = scroller(catalogRoot())
        if (s) s.scrollTop = y
      }),
    )
  },
}))

export const openItem = (it: OpenItem) => useItem.getState().open(it)
export const closeItem = () => useItem.getState().close()
/** Закрыть страницу материала без возврата прокрутки — при переходе на другую вкладку. */
export const dropItem = () => useItem.setState({ cur: null })
