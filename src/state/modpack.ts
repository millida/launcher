import { create } from 'zustand'
import { modpackVersions } from '../ipc/commands'
import type { ModpackVersion } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { openModal, showToast } from './ui'

interface ModpackState {
  profile: string
  slug: string
  title: string
  mode: 'update' | 'install'
  curId: string
  list: ModpackVersion[]
  labels: Record<string, string>
  setLabel: (id: string, v: string) => void
  open: (profile: string, slug: string, curId: string) => Promise<void>
  openInstall: (slug: string, title: string) => Promise<void>
}

export const useModpackVersions = create<ModpackState>((set, get) => ({
  profile: '',
  slug: '',
  title: '',
  mode: 'update',
  curId: '',
  list: [],
  labels: {},
  setLabel: (id, v) => set({ labels: { ...get().labels, [id]: v } }),
  open: async (profile, slug, curId) => {
    if (!hasTauri()) {
      showToast('Доступно в приложении')
      return
    }
    showToast('Загружаем версии модпака…')
    try {
      const list = await modpackVersions(slug)
      set({ profile, slug, mode: 'update', curId, list: list || [], labels: {} })
      openModal('mpOverlay')
    } catch (e) {
      showToast('' + e, 'error')
    }
  },
  openInstall: async (slug, title) => {
    if (!hasTauri()) {
      showToast('Установка сборок — в приложении', 'error')
      return
    }
    showToast('Смотрим версии «' + title + '»…')
    try {
      const list = await modpackVersions(slug)
      set({ profile: '', slug, title, mode: 'install', curId: '', list: list || [], labels: {} })
      openModal('mpOverlay')
    } catch (e) {
      showToast('Не удалось получить версии: ' + e, 'error')
    }
  },
}))
