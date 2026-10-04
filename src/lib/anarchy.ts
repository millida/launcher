import { hasTauri } from '../ipc/tauri'
import { pingServer } from '../ipc/commands'
import { ensureVersionBuild, versionFps } from './versionBuild'
import { quickJoin } from './joinServer'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { useMemo } from 'react'
import { anarchyServer, withAnarchyPromo, type AnarchyServer } from './ownServer'
import { usePromo } from '../state/promo'

/**
 * A 1.21.4 build fits the 1.21 line for an ordinary server, but the anarchy
 * expects 1.21.11 exactly, so the build of that version is made current
 * before the usual join picks one.
 */
export async function playAnarchy(): Promise<void> {
  const an = anarchyServer()
  if (!hasTauri()) {
    showToast('Подключение к серверу доступно в приложении', 'error')
    return
  }
  const build = await ensureVersionBuild(an.version, { fps: versionFps(an.version) })
  if (!build) {
    showToast('Не получилось подготовить Minecraft ' + an.version + '. Нажми «Играть» ещё раз.', 'error')
    return
  }
  useProfiles.getState().setSelected(build)
  return quickJoin(an.addr, an.fullName, false, [an.version])
}

const ONLINE_TTL = 60_000
const PING_WAIT = 6_000
let online: { at: number; addr: string; value: Promise<number | null> } | null = null

/** Players on the anarchy right now, from the server itself: it has no rating card. */
export function loadAnarchyOnline(): Promise<number | null> {
  if (!hasTauri()) return Promise.resolve(null)
  const addr = anarchyServer().addr
  if (online && online.addr !== addr) online = null
  if (online && Date.now() - online.at < ONLINE_TTL) return online.value
  const value = Promise.race([
    pingServer(addr).then((p) => (Number.isFinite(p.online) && p.online >= 0 ? p.online : null)),
    new Promise<null>((r) => setTimeout(() => r(null), PING_WAIT)),
  ]).catch((e) => {
    console.warn('[anarchy] ping', e)
    online = null
    return null
  })
  online = { at: Date.now(), addr, value }
  return value
}

/** The anarchy as cards draw it: re-renders when the API changes its name, address or version. */
export function useAnarchy(): AnarchyServer {
  const promo = usePromo((s) => s.promo.anarchy)
  return useMemo(() => withAnarchyPromo(promo), [promo])
}
