import { create } from 'zustand'
import { listScreenshots } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { openModal, showToast } from './ui'
import { t } from '../i18n'

interface ScreensState {
  profile: string
  paths: string[]
  open: (profile: string) => Promise<void>
}

export const useScreens = create<ScreensState>((set) => ({
  profile: '',
  paths: [],
  open: async (profile) => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'))
      return
    }
    try {
      const paths = await listScreenshots(profile)
      if (!paths || !paths.length) {
        showToast(t('Скриншотов пока нет — сделай F2 в игре'))
        return
      }
      set({ profile, paths })
      openModal('shotOverlay')
    } catch (e) {
      showToast('' + e)
    }
  },
}))
