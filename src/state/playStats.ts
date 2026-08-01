import { create } from 'zustand'
import { getPlayStats, labelServer } from '../ipc/commands'
import type { PlayStats } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { api, hasMillidaAccount } from '../lib/api'

const EMPTY: PlayStats = {
  total_seconds: 0,
  sessions: 0,
  builds: [],
  servers: [],
  last_build: '',
  last_server: '',
  last_server_name: '',
  last_at: 0,
}

export const statsShared = (): boolean => localStorage.getItem('m-share-stats') !== '0'

export const setStatsShared = (on: boolean) => {
  localStorage.setItem('m-share-stats', on ? '1' : '0')
  if (on) void refreshPlayStats()
  else void api('/friends/stats/hide', { method: 'POST' }).catch(() => {})
}

interface State {
  stats: PlayStats
  loaded: boolean
  refresh: () => Promise<void>
}

export const usePlayStats = create<State>((set) => ({
  stats: EMPTY,
  loaded: false,
  refresh: async () => {
    if (!hasTauri()) {
      set({ stats: EMPTY, loaded: true })
      return
    }
    try {
      const stats = await getPlayStats()
      set({ stats, loaded: true })
      void syncPlayStats(stats)
    } catch {
      set({ loaded: true })
    }
  },
}))

export const refreshPlayStats = () => usePlayStats.getState().refresh()

export const buildStat = (build: string) =>
  usePlayStats.getState().stats.builds.find((b) => b.key === build) || null

export function rememberServerName(addr: string, name: string) {
  if (!addr || !name || !hasTauri()) return
  void labelServer(addr, name).catch(() => {})
}

async function syncPlayStats(stats: PlayStats) {
  if (!hasMillidaAccount() || !statsShared() || !stats.total_seconds) return
  try {
    await api('/friends/stats', {
      method: 'POST',
      body: JSON.stringify({
        totalSeconds: stats.total_seconds,
        sessions: stats.sessions,
        lastBuild: stats.last_build || undefined,
        lastServer: stats.last_server || undefined,
        lastServerName: stats.last_server_name || undefined,
        lastPlayedAt: stats.last_at ? stats.last_at * 1000 : undefined,
        builds: stats.builds.slice(0, 5).map((b) => ({
          name: b.key,
          seconds: b.seconds,
          last: b.last * 1000,
        })),
        servers: stats.servers.slice(0, 5).map((s) => ({
          addr: s.key,
          name: s.label || undefined,
          seconds: s.seconds,
          last: s.last * 1000,
        })),
      }),
    })
  } catch {}
}
