import { create } from 'zustand'
import { listScreenshots } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { openModal, showToast } from './ui'

interface ScreensState {
  profile: string
  paths: string[]
  big: string
  setBig: (s: string) => void
  open: (profile: string) => Promise<void>
}

export const useScreens = create<ScreensState>((set) => ({
  profile: '',
  paths: [],
  big: '',
  setBig: (s) => set({ big: s }),
  open: async (profile) => {
    if (!hasTauri()) {
      showToast('Доступно в приложении')
      return
    }
    try {
      const paths = await listScreenshots(profile)
      if (!paths || !paths.length) {
        showToast('Скриншотов пока нет — сделай F2 в игре')
        return
      }
      set({ profile, paths, big: '' })
      openModal('shotOverlay')
    } catch (e) {
      showToast('' + e)
    }
  },
}))
