import { create } from 'zustand'

/**
 * Верхняя строка экранов: кнопка возврата и действия экрана (правка владельца
 * 23.09.2026, 22:38). Экран с подстраницей (страница сборки, «Все …»)
 * подменяет «← Лобби» на «← Назад»; гардероб кладёт сюда «Загрузить» и «Импорт».
 */
interface TopBarState {
  back: (() => void) | null
  setBack: (fn: (() => void) | null) => void
}

export const useTopBar = create<TopBarState>((set) => ({
  back: null,
  setBack: (fn) => set({ back: fn }),
}))

/** Гардероб: кнопки верхней строки зовут экран событиями. */
export const SKINS_UPLOAD_EVENT = 'm-skins-upload'
export const SKINS_IMPORT_EVENT = 'm-skins-import'
