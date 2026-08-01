import { create } from 'zustand'
import { checkUpdates, updateAll } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { useProfiles } from './profiles'
import { showToast } from './ui'

interface State {
  count: number
  byProfile: Record<string, number>
  scanning: boolean
  updating: boolean
  scannedCount: number
  scan: (force?: boolean) => Promise<void>
  runAll: () => Promise<void>
}

// Freshness window: the screen remounts on every visit, but mod releases are rare.
const SCAN_TTL = 1800000
let lastScan = 0

export const useModUpdates = create<State>((set, get) => ({
  count: 0,
  byProfile: {},
  scanning: false,
  updating: false,
  scannedCount: -1,
  scan: async (force = false) => {
    if (!hasTauri() || get().scanning) return
    if (!force && lastScan && Date.now() - lastScan < SCAN_TTL) return
    set({ scanning: true })
    const profiles = useProfiles.getState().profiles
    const found = await Promise.all(
      profiles.map((p) =>
        checkUpdates(p.name, 'mod')
          .then((ups) => [p.name, ups ? ups.length : 0] as const)
          .catch(() => [p.name, 0] as const),
      ),
    )
    const by: Record<string, number> = {}
    found.forEach(([name, n]) => {
      if (n) by[name] = n
    })
    lastScan = Date.now()
    set({
      byProfile: by,
      count: Object.values(by).reduce((a, b) => a + b, 0),
      scanning: false,
      scannedCount: profiles.length,
    })
  },
  runAll: async () => {
    if (!hasTauri() || get().updating) return
    const names = Object.keys(get().byProfile)
    if (!names.length) return
    set({ updating: true })
    showToast('Обновляем моды во всех сборках…')
    let done = 0
    for (const name of names) {
      try {
        done += await updateAll(name, 'mod')
      } catch {}
    }
    showToast(done ? 'Обновлено модов: ' + done : 'Обновлять нечего')
    set({ updating: false })
    await get().scan(true)
  },
}))
