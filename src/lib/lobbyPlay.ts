import { hasTauri } from '../ipc/tauri'
import { loadProfileSettings } from '../ipc/commands'
import { ensureVersionBuild, versionFps } from './versionBuild'
import type { Profile } from '../ipc/commands'
import { cancelPrelaunch, realLaunch, startPrelaunch } from './launch'
import { quickJoin } from './joinServer'
import { setScreen, useUi } from '../state/ui'
import { useLobby } from '../state/lobbyMode'
import type { LobbyMode } from '../state/lobbyMode'

const launch = (name: string) => (hasTauri() ? realLaunch(name) : startPrelaunch(name))

/** Установленная сборка из каталога с этим слагом, если такая есть. */
export async function installedPack(slug: string | null, profiles: Profile[]): Promise<string | null> {
  if (!slug || !hasTauri()) return null
  for (const p of profiles) {
    const st = await loadProfileSettings(p.name).catch(() => null)
    if (st && (st.catalogPackSlug === slug || st.modpackSlug === slug)) return p.name
  }
  return null
}

/** Страница премиум-сборки: там оформляют доступ и ставят. */
export function openPremiumPack(id: string) {
  useLobby.setState({ premiumTarget: id })
  setScreen('premium')
}

/**
 * «Играть» для любого режима. Премиум-сборка, которой ещё нет на компьютере,
 * ведёт на свою страницу: доступ и установка живут там, а не на главной.
 */
export async function playMode(m: LobbyMode, profiles: Profile[]): Promise<void> {
  // Уже идёт подготовка — повторный «Играть» (любой сборки) отменяет её.
  if (useUi.getState().prelaunch.open) {
    cancelPrelaunch()
    return
  }
  if (m.kind === 'build') return launch(m.name)
  if (m.kind === 'version') {
    // Сборка под версию — общая с каталогом режимов: Fabric, FPS-моды по
    // тумблеру из каталога, мод косметики (lib/versionBuild.ts).
    const name = await ensureVersionBuild(m.version, { fps: versionFps(m.version) })
    if (name) launch(name)
    return
  }
  if (m.kind === 'server') return quickJoin(m.ip, m.name, m.licensed, m.versions)
  const have = await installedPack(m.slug, profiles)
  if (have) return launch(have)
  openPremiumPack(m.id)
}
