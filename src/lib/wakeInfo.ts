import { useEffect, useState } from 'react'
import { hasTauri } from '../ipc/tauri'
import { api } from './api'
import { inTime } from './deadline'

/// GET /hosting/client/join-info?address= — public, no account needed.
export interface JoinInfo {
  serverId: string
  address: string
  status: 'online' | 'starting' | 'sleeping' | 'offline'
  joinStartsServer: boolean
}

const asked = new Map<string, Promise<JoinInfo | null>>()

/// One question per address per session: a list of a hundred offline servers
/// must not become a hundred requests on every render.
export function joinInfo(addr: string): Promise<JoinInfo | null> {
  const key = addr.trim().toLowerCase()
  const hit = asked.get(key)
  if (hit) return hit
  const p = inTime(api<JoinInfo>('/hosting/client/join-info?address=' + encodeURIComponent(key)), 3000).catch(() => null)
  asked.set(key, p)
  return p
}

export const wakesOnJoin = (info: JoinInfo | null): boolean => !!info && info.status === 'sleeping' && info.joinStartsServer

/// A Millida hosting server that sleeps and wakes on join: the list shows
/// «Включить и зайти» instead of an «офлайн» it cannot act on. Asked only for
/// servers the list already sees as offline.
export function useWakeOnJoin(addr: string | null | undefined, offline: boolean): boolean {
  const [wakes, setWakes] = useState(false)
  useEffect(() => {
    setWakes(false)
    if (!offline || !addr || !hasTauri()) return
    let alive = true
    void joinInfo(addr).then((info) => alive && setWakes(wakesOnJoin(info)))
    return () => {
      alive = false
    }
  }, [addr, offline])
  return wakes
}
