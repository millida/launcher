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

/** Набор, который примеряют: гардероб покажет «Докупить набор» с этой ценой. */
export interface SetOffer {
  setId: string
  colorway: string
  title: string
  price: number
}

interface WearIntent {
  refs: WearRef[] | null
  /** Примерить всё, даже своё: на фигуре весь набор, а не только чужие вещи. */
  fit: boolean
  offer: SetOffer | null
  set: (refs: WearRef[] | null, opts?: { fit?: boolean; offer?: SetOffer }) => void
}

export const useWearIntent = create<WearIntent>((set) => ({
  refs: null,
  fit: false,
  offer: null,
  set: (refs, opts) => set({ refs, fit: !!opts?.fit, offer: opts?.offer ?? null }),
}))

/**
 * Надеть и открыть гардероб. Открытие гардероба тяжёлое (3D-сцена, вещи): экран сначала притухает
 * (navPending, как у любого перехода), и только следующим кадром начинается переход — нажатие
 * видно сразу, даже если потом главный поток занят (04.11.2026: «кнопки подвисают»).
 */
export function wearNow(refs: WearRef[], opts?: { fit?: boolean; offer?: SetOffer }) {
  useWearIntent.getState().set(refs.length ? refs : null, opts)
  // Модели и картинки вещей — сразу, пока открывается гардероб (lib/wearPrefetch, своим чанком).
  if (refs.length) void import('../lib/wearPrefetch').then((m) => m.prefetchWear(refs)).catch(() => {})
  useUi.setState({ navPending: true })
  requestAnimationFrame(() => {
    window.setTimeout(() => useUi.getState().setScreen('skins'), 0)
  })
}
