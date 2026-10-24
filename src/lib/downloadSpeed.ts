import { create } from 'zustand'
import { tauri } from '../ipc/tauri'
import { t } from '../i18n'

/// A reading older than this is not shown: the core reports speed only with progress events.
const STALE_MS = 4000

interface SpeedState {
  bps: number
  at: number
}

export const useDownloadSpeed = create<SpeedState>(() => ({ bps: 0, at: 0 }))

let started = false

export function initDownloadSpeed() {
  const T = tauri()
  if (started || !T) return
  started = true
  void T.event
    .listen<{ bps?: number }>('install-progress', (e) => {
      const bps = Number(e.payload?.bps) || 0
      useDownloadSpeed.setState({ bps, at: Date.now() })
    })
    .catch(() => {
      started = false
    })
}

export function speedText(bps: number, at: number, now = Date.now()): string | null {
  if (bps < 1024 || now - at > STALE_MS) return null
  const mb = bps / (1024 * 1024)
  if (mb >= 1) return t('{n} МБ/с', { n: mb >= 10 ? Math.round(mb) : mb.toFixed(1) })
  return t('{n} КБ/с', { n: Math.round(bps / 1024) })
}
