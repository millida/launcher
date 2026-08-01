import { startTransition } from 'react'
import { create } from 'zustand'
import { playSound } from '../lib/sound'
import type { SoundEvent } from '../lib/sound'

export type ScreenId = 'play' | 'builds' | 'servers' | 'mods' | 'skins' | 'friends' | 'hosting' | 'settings'
export type ModalId =
  | 'nbModal'
  | 'bsModal'
  | 'impModal'
  | 'pjModal'
  | 'setModal'
  | 'accModal'
  | 'shotOverlay'
  | 'mpOverlay'

export interface ModalState {
  open: boolean
  vis: boolean
}

export interface PrelaunchState {
  open: boolean
  sub: string
  stage: number
  msg: string | null
  pct: number
}

export type ToastKind = 'ok' | 'error'

interface UiState {
  logged: boolean
  screen: ScreenId
  toastMsg: string
  toastKind: ToastKind
  toastShow: boolean
  modals: Record<ModalId, ModalState>
  prelaunch: PrelaunchState
  setLogged: (v: boolean) => void
  setScreen: (s: ScreenId) => void
  showToast: (msg: string, kind?: ToastKind, sound?: SoundEvent | false) => void
  hideToast: () => void
  openModal: (id: ModalId) => void
  closeModal: (id: ModalId) => void
  setPrelaunch: (p: Partial<PrelaunchState>) => void
}

const emptyModal = (): ModalState => ({ open: false, vis: false })

function hasStoredAccount(): boolean {
  try {
    const list = JSON.parse(localStorage.getItem('m-accounts') || 'null')
    if (Array.isArray(list) && list.length) return true
    const legacy = JSON.parse(localStorage.getItem('m-account') || 'null')
    return !!(legacy && legacy.nick)
  } catch {
    return false
  }
}

const ERROR_RE =
  /(ошибк|не удалось|не удаётся|отклон|устарел|истек|истёк|время вышло|недоступ|не настроен|не найден|нет лицензии|отказал|failed|error|AADSTS)/i

let toastTimer: ReturnType<typeof setTimeout> | undefined
const closeTimers: Partial<Record<ModalId, ReturnType<typeof setTimeout>>> = {}

export const useUi = create<UiState>((set, get) => ({
  logged: hasStoredAccount(),
  screen: 'play',
  toastMsg: 'Скопировано',
  toastKind: 'ok',
  toastShow: false,
  modals: {
    nbModal: emptyModal(),
    bsModal: emptyModal(),
    impModal: emptyModal(),
    pjModal: emptyModal(),
    setModal: emptyModal(),
    accModal: emptyModal(),
    shotOverlay: emptyModal(),
    mpOverlay: emptyModal(),
  },
  prelaunch: { open: false, sub: 'Fabulously Optimized · Fabric', stage: 0, msg: null, pct: 0 },
  setLogged: (v) => set({ logged: v }),
  // Transition keeps the current screen mounted while the next chunk loads,
  // instead of flashing the empty Suspense fallback.
  setScreen: (s) => startTransition(() => set({ screen: s })),
  showToast: (msg, kind, sound) => {
    const k = kind || (ERROR_RE.test(msg) ? 'error' : 'ok')
    set({ toastMsg: msg, toastKind: k, toastShow: true })
    if (sound !== false) playSound(sound || (k === 'error' ? 'error' : 'success'))
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => get().hideToast(), 2600)
  },
  hideToast: () => set({ toastShow: false }),
  openModal: (id) => {
    clearTimeout(closeTimers[id])
    closeTimers[id] = undefined
    if (!get().modals[id].open) playSound('open')
    set({ modals: { ...get().modals, [id]: { open: true, vis: false } } })
    requestAnimationFrame(() => {
      if (!get().modals[id].open) return
      set({ modals: { ...get().modals, [id]: { open: true, vis: true } } })
    })
  },
  closeModal: (id) => {
    const cur = get().modals[id]
    if (!cur.open || (!cur.vis && closeTimers[id])) return
    playSound('close')
    set({ modals: { ...get().modals, [id]: { open: true, vis: false } } })
    clearTimeout(closeTimers[id])
    closeTimers[id] = setTimeout(() => {
      closeTimers[id] = undefined
      set({ modals: { ...get().modals, [id]: { open: false, vis: false } } })
    }, 240)
  },
  setPrelaunch: (p) => set({ prelaunch: { ...get().prelaunch, ...p } }),
}))

export const showToast = (msg: string, kind?: ToastKind, sound?: SoundEvent | false) =>
  useUi.getState().showToast(msg, kind, sound)
export const openModal = (id: ModalId) => useUi.getState().openModal(id)
export const closeModal = (id: ModalId) => useUi.getState().closeModal(id)
export const setScreen = (s: ScreenId) => useUi.getState().setScreen(s)
export const enterApp = () => useUi.getState().setLogged(true)
export const logoutToLogin = () => useUi.getState().setLogged(false)
