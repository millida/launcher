import { create } from 'zustand'
import { useUi } from './ui'

/**
 * «Надеть» / «Примерить» вне гардероба (владелец 24.09.2026, 19:56): вещь из
 * сундука, пропуска или магазина сразу надевается (своя) или встаёт на фигуру
 * примеркой (чужая) — гардероб открывается уже с ней. Коды — как у службы:
 * «КОД» или «КОД~расцветка».
 */
export interface WearRef {
  code: string
  variant?: string
}

interface WearIntent {
  refs: WearRef[] | null
  set: (refs: WearRef[] | null) => void
}

export const useWearIntent = create<WearIntent>((set) => ({
  refs: null,
  set: (refs) => set({ refs }),
}))

export function wearNow(refs: WearRef[]) {
  useWearIntent.getState().set(refs.length ? refs : null)
  useUi.getState().setScreen('skins')
}
