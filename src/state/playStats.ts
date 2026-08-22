import { create } from 'zustand'
import { getPlayStats, labelServer } from '../ipc/commands'
import type { PlayStats } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { api, hasMillidaAccount } from '../lib/api'
import { useServers } from './servers'
import { canonAddr } from '../lib/serverAddr'
import { privacySettings, usePrivacy } from '../lib/privacy'

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

/// Раньше это был локальный ключ m-share-stats, из-за чего лаунчер и сайт
/// показывали разное. Теперь настройка одна — серверное поле showPlaytime
/// (см. lib/privacy.ts); локальный ключ остался только зеркалом.
export const statsShared = (): boolean => privacySettings().showPlaytime

// Смена showPlaytime приезжает и из лаунчера, и с сайта: реагируем на сам факт
// изменения, а не на клик по тумблеру. Выключили — просим сервер убрать уже
// синхронизированную статистику, включили — заливаем её заново.
let lastShared = statsShared()
usePrivacy.subscribe((s) => {
  const now = s.settings.showPlaytime
  if (now === lastShared) return
  lastShared = now
  if (now) void refreshPlayStats()
  else void api('/friends/stats/hide', { method: 'POST' }).catch(() => {})
})

interface State {
  stats: PlayStats
  /** Секунды, которые подтвердил сервер; null — ещё не спрашивали. */
  verifiedSeconds: number | null
  loaded: boolean
  refresh: () => Promise<void>
}

export const usePlayStats = create<State>((set) => ({
  stats: EMPTY,
  verifiedSeconds: null,
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

/**
 * Локальный счётчик и подтверждённое время считаются по-разному: второе растёт
 * только пока сервер видит удары. Показываем оба, иначе разница читается как
 * потерянные часы.
 */
export const setVerifiedSeconds = (seconds: number | null) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return
  usePlayStats.setState({ verifiedSeconds: Math.round(seconds) })
}

export const buildStat = (build: string) =>
  usePlayStats.getState().stats.builds.find((b) => b.key === build) || null

export { canonAddr }

/** Имя сервера для адреса: сначала то, что уже знает ядро, затем рейтинг. */
export function serverNameFor(addr: string): string {
  const key = canonAddr(addr)
  if (!key) return ''
  const known = usePlayStats.getState().stats.servers.find((s) => canonAddr(s.key) === key)
  if (known && known.label) return known.label
  const rated = useServers.getState().list.find((s) => canonAddr(s.ip) === key)
  return (rated && rated.name) || ''
}

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
