import { useEffect, useState } from 'react'
import { hasTauri } from '../ipc/tauri'
import { headAvatar } from '../ipc/commands'
import { monogramAvatar } from './format'

const OFFLINE_NICK = 'MHF_Steve'

const mem = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
const RETRY_MS = 60_000
const failedAt = new Map<string, number>()

/**
 * A face is 8x8 skin pixels, so a head only stays sharp when its size is a
 * multiple of 8: at any other size one skin pixel covers 5 screen pixels and
 * its neighbour covers 6, which reads as a torn, crooked face.
 */
const HEAD_CELLS = 8
const HEAD_MAX = 512

/** Render size for a box of `box` CSS pixels: doubled for HiDPI, snapped to the grid. */
export const headPx = (box: number): number =>
  Math.min(HEAD_MAX, Math.max(HEAD_CELLS, Math.round((box * 2) / HEAD_CELLS) * HEAD_CELLS))

const norm = (nick?: string): string => (nick || '').trim().toLowerCase()

const cacheKey = (nick: string, px: number): string => `${norm(nick)}@${px}`

export const headNick = (nick?: string, kind?: string): string =>
  kind === 'offline' || !norm(nick) ? OFFLINE_NICK : (nick as string).trim()

export const cachedHead = (nick?: string, kind?: string, px = headPx(32)): string | null =>
  mem.get(cacheKey(headNick(nick, kind), px)) || null

export function loadHead(nick?: string, kind?: string, px = headPx(32)): Promise<string | null> {
  const real = headNick(nick, kind)
  const key = cacheKey(real, px)
  const hit = mem.get(key)
  if (hit) return Promise.resolve(hit)
  const failed = failedAt.get(key)
  if (failed && Date.now() - failed < RETRY_MS) return Promise.resolve(null)
  const running = inflight.get(key)
  if (running) return running
  const task = (
    hasTauri()
      ? headAvatar(real, px)
      : Promise.resolve(
          'https://api.millida.net/v2/heads/avatar/' + encodeURIComponent(real) + '?size=' + px,
        )
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
  const px = headPx(size)
  const [src, setSrc] = useState<string>(
    () => override || cachedHead(nick, undefined, px) || monogramAvatar(nick, size),
  )
  useEffect(() => {
    if (override) {
      setSrc(override)
      return
    }
    const hit = cachedHead(nick, undefined, px)
    setSrc(hit || monogramAvatar(nick, size))
    if (hit) return
    let alive = true
    void loadHead(nick, undefined, px).then((url) => {
      if (alive && url) setSrc(url)
    })
    return () => {
      alive = false
    }
  }, [nick, size, px, override])
  return src
}
