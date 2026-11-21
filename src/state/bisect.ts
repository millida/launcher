import { create } from 'zustand'
import type { BisectView } from '../ipc/commands'

/** Событие для вкладки модов: поиск виновника переключил моды сборки (detail — имя сборки). */
export const BISECT_MODS_EVENT = 'm-bisect-mods'

interface BisectState {
  /** Сборка, для которой открыт мастер поиска мода-виновника; '' — закрыт. */
  profile: string
  view: BisectView | null
  /** Вылет пришёл, пока окно было закрыто: ответ «вылетело» мастер отправит сам. */
  crashed: boolean
  open: (profile: string, view?: BisectView | null) => void
  close: () => void
}

export const useBisect = create<BisectState>((set) => ({
  profile: '',
  view: null,
  crashed: false,
  open: (profile, view = null) => set({ profile, view, crashed: false }),
  close: () => set({ profile: '', view: null, crashed: false }),
}))

export const openBisect = (profile: string) => useBisect.getState().open(profile)

export const announceBisectMods = (profile: string) => window.dispatchEvent(new CustomEvent(BISECT_MODS_EVENT, { detail: profile }))

/**
 * Вылет во время проверки — это ответ мастеру, а не повод для окна вылета и авто-починки
 * (починка вернула бы выключенные на проверку моды). `true` — вылет забрал мастер.
 */
export function bisectTakesCrash(profile: string): boolean {
  const s = useBisect.getState()
  if (!profile || s.profile !== profile || s.view?.phase !== 'test') return false
  useBisect.setState({ crashed: true })
  return true
}
