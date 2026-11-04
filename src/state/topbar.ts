import { create } from 'zustand'

/**
 * Верхняя строка экранов: кнопка возврата и действия экрана (правка владельца
 * 23.09.2026, 22:38). Экран с подстраницей (страница сборки, «Все …»)
 * подменяет «← Лобби» на «← Назад»; гардероб кладёт сюда «Загрузить» и «Импорт».
 */
interface TopBarState {
  back: (() => void) | null
  setBack: (fn: (() => void) | null) => void
  /** Подстраница без вкладок «Библиотека | Ресурсы» наверху — только «← Назад». */
  bare: boolean
  setBare: (v: boolean) => void
  /** Wardrobe: the character wears something to remove (items, a try-on, a cape), so Remove all is active. */
  skinsWorn: boolean
  setSkinsWorn: (v: boolean) => void
}

export const useTopBar = create<TopBarState>((set) => ({
  back: null,
  setBack: (fn) => set({ back: fn }),
  bare: false,
  setBare: (v) => set({ bare: v }),
  skinsWorn: false,
  setSkinsWorn: (v) => set({ skinsWorn: v }),
}))

/** Гардероб: кнопки верхней строки зовут экран событиями. */
export const SKINS_UPLOAD_EVENT = 'm-skins-upload'
export const SKINS_IMPORT_EVENT = 'm-skins-import'
export const SKINS_TAKE_OFF_EVENT = 'm-skins-take-off'
