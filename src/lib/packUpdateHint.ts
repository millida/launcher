import { useEffect, useState } from 'react'
import type { Profile } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import type { LobbyMode } from '../state/lobbyMode'
import { installedPack } from './lobbyPlay'
import { findPackUpdate } from './packLaunch'
import type { PackUpdate } from './packUpdate'

interface Hint {
  target: string
  update: PackUpdate | null
}

const targetOf = (mode: LobbyMode | null): string =>
  mode?.kind === 'build' ? 'build:' + mode.name : mode?.kind === 'premium' && mode.slug ? 'pack:' + mode.slug : ''

/**
 * The newer published version of the build on the lobby card. Asked again when
 * the window gets focus or the build list changes; the card answer is cached
 * for five minutes, so focusing the window does not reach the network each time.
 */
export function usePackUpdateHint(mode: LobbyMode | null, profiles: Profile[], on: boolean): PackUpdate | null {
  const [hint, setHint] = useState<Hint>({ target: '', update: null })
  const [focus, setFocus] = useState(0)
  const target = targetOf(mode)

  useEffect(() => {
    if (!on) return
    const bump = () => setFocus((n) => n + 1)
    window.addEventListener('focus', bump)
    return () => window.removeEventListener('focus', bump)
  }, [on])

  useEffect(() => {
    if (!on || !target || !hasTauri()) return
    let alive = true
    const name =
      mode?.kind === 'build' ? Promise.resolve(mode.name) : installedPack(mode?.kind === 'premium' ? mode.slug : null, profiles)
    name
      .then((n) => (n ? findPackUpdate(n) : null))
      .then((update) => {
        if (alive) setHint({ target, update })
      })
      // Only the hint is lost: Play checks again and says what went wrong.
      .catch(() => {
        if (alive) setHint({ target, update: null })
      })
    return () => {
      alive = false
    }
  }, [target, on, focus, profiles])

  return hint.target === target ? hint.update : null
}
