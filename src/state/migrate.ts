import { create } from 'zustand'
import { migratePlan } from '../ipc/commands'
import type { MigratePlan } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { openModal, showToast } from './ui'

interface MigrateState {
  profile: string
  version: string
  loader: string
  plan: MigratePlan | null
  loading: boolean
  error: string
  open: (profile: string, version: string, loader: string) => void
  set: (p: Partial<MigrateState>) => void
  load: () => Promise<void>
}

// The plan is a read-only look at the catalogue: it may be asked for as often as
// the target version changes, and nothing on disk moves until the build itself
// is migrated.
export const useMigrate = create<MigrateState>((set, get) => ({
  profile: '',
  version: '',
  loader: 'fabric',
  plan: null,
  loading: false,
  error: '',
  set: (p) => set(p),
  open: (profile, version, loader) => {
    if (!hasTauri()) {
      showToast('Перенос сборки доступен в приложении', 'error')
      return
    }
    set({ profile, version, loader, plan: null, loading: false, error: '' })
    openModal('mgModal')
  },
  load: async () => {
    const { profile, version, loader } = get()
    if (!profile || !version) return
    set({ loading: true, error: '', plan: null })
    try {
      const plan = await migratePlan(profile, version, loader)
      if (get().profile !== profile || get().version !== version || get().loader !== loader) return
      set({ plan, loading: false })
    } catch (e) {
      if (get().profile !== profile) return
      set({ loading: false, error: '' + e })
    }
  },
}))
