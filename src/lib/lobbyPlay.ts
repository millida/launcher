import { hasTauri } from '../ipc/tauri'
import { PACK_ACCESS_PREFIX, installCatalogPack, loadProfileSettings } from '../ipc/commands'
import { ensureVersionBuild, versionFps } from './versionBuild'
import type { Profile } from '../ipc/commands'
import { cancelPrelaunch, realLaunch, startPrelaunch } from './launch'
import { quickJoin } from './joinServer'
import { setScreen, showToast, useUi } from '../state/ui'
import { useLobby } from '../state/lobbyMode'
import type { LobbyMode } from '../state/lobbyMode'
import { useProfiles } from '../state/profiles'
import { runInstall } from '../state/installs'
import { keyCatalogPack } from './installKeys'
import { catalogInstallTracker } from './install'
import { ONEBLOCK_PACK, targetsAnarchy, targetsOwnServer } from './ownServer'
import { playAnarchy } from './anarchy'

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
  if (targetsOwnServer(m)) return playOwnServer(profiles)
  if (targetsAnarchy(m)) return playAnarchy()
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

/**
 * OneBlock is our event server, not a pack to browse or a vanilla address:
 * one press installs its own client when it is missing and starts it.
 */
export async function playOwnServer(profiles: Profile[]): Promise<void> {
  const have = await installedPack(ONEBLOCK_PACK, profiles)
  if (have) return launch(have)
  if (!hasTauri()) {
    showToast('Установка сборок — в приложении', 'error')
    return
  }
  const installed = catalogInstallTracker('modpack', ONEBLOCK_PACK, 'own_server')
  runInstall({
    key: keyCatalogPack(ONEBLOCK_PACK),
    title: 'OneBlock',
    running: 'Скачивание…',
    run: () => installCatalogPack(ONEBLOCK_PACK),
    onError: (e) => {
      if (String(e).startsWith(PACK_ACCESS_PREFIX)) openPremiumPack(ONEBLOCK_PACK)
      else showToast('OneBlock не установился: ' + String(e) + '. Нажми «Играть» ещё раз.', 'error')
    },
    onDone: (p) => {
      installed()
      useProfiles.getState().setSelected(p.name)
      void useProfiles.getState().refresh()
      launch(p.name)
    },
  })
}
