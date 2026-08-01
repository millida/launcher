import { useEffect, useState } from 'react'
import { hasTauri } from '../ipc/tauri'
import { headAvatar } from '../ipc/commands'
import { monogramAvatar } from './format'

const OFFLINE_NICK = 'MHF_Steve'

const mem = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
const RETRY_MS = 60_000
const failedAt = new Map<string, number>()

const norm = (nick?: string): string => (nick || '').trim().toLowerCase()

export const headNick = (nick?: string, kind?: string): string =>
  kind === 'offline' || !norm(nick) ? OFFLINE_NICK : (nick as string).trim()

export const cachedHead = (nick?: string, kind?: string): string | null =>
  mem.get(norm(headNick(nick, kind))) || null

export function loadHead(nick?: string, kind?: string): Promise<string | null> {
  const real = headNick(nick, kind)
  const key = norm(real)
  const hit = mem.get(key)
  if (hit) return Promise.resolve(hit)
  const failed = failedAt.get(key)
  if (failed && Date.now() - failed < RETRY_MS) return Promise.resolve(null)
  const running = inflight.get(key)
  if (running) return running
  const task = (
    hasTauri()
      ? headAvatar(real)
      : Promise.resolve('https://mc-heads.net/avatar/' + encodeURIComponent(real) + '/64')
  )
    .then((url) => {
      mem.set(key, url)
      return url
    })
    .catch(() => {
      failedAt.set(key, Date.now())
      return null
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

export function warmHeads(nicks: (string | undefined)[]): void {
  for (const nick of nicks.slice(0, 60)) if (norm(nick)) void loadHead(nick)
}

export function useHead(nick?: string, size = 32, override?: string | null): string {
  const [src, setSrc] = useState<string>(() => override || cachedHead(nick) || monogramAvatar(nick, size))
  useEffect(() => {
    if (override) {
      setSrc(override)
      return
    }
    const hit = cachedHead(nick)
    setSrc(hit || monogramAvatar(nick, size))
    if (hit) return
    let alive = true
    void loadHead(nick).then((url) => {
      if (alive && url) setSrc(url)
    })
    return () => {
      alive = false
    }
  }, [nick, size, override])
  return src
}
