import { hasTauri } from '../ipc/tauri'
import { PACK_ACCESS_PREFIX, installCatalogPack, loadProfileSettings } from '../ipc/commands'
import { ensureVersionBuild, versionFps } from './versionBuild'
import type { Profile } from '../ipc/commands'
import { cancelPrelaunch, realLaunch, startPrelaunch, withLaunchPrep } from './launch'
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
import { t, tx } from '../i18n'

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
    // The version build is shared with the modes catalog: Fabric, FPS mods by the catalog's toggle,
    // the cosmetics mod (lib/versionBuild.ts). It cannot be built without the core.
    if (!hasTauri()) return
    const prep = await withLaunchPrep('Minecraft ' + m.version, () => ensureVersionBuild(m.version, { fps: versionFps(m.version) }))
    if (!prep) return
    if (prep.value) launch(prep.value)
    else showToast(t('Не получилось подготовить Minecraft {version}. Нажми «Играть» ещё раз.', { version: m.version }), 'error')
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
    showToast(t('Установка сборок — в приложении'), 'error')
    return
  }
  const installed = catalogInstallTracker('modpack', ONEBLOCK_PACK, 'own_server')
  runInstall({
    key: keyCatalogPack(ONEBLOCK_PACK),
    title: 'OneBlock',
    running: t('Скачивание…'),
    run: () => installCatalogPack(ONEBLOCK_PACK),
    onError: (e) => {
      if (String(e).startsWith(PACK_ACCESS_PREFIX)) openPremiumPack(ONEBLOCK_PACK)
      else showToast(t('OneBlock не установился: {error}. Нажми «Играть» ещё раз.', { error: tx(e) }), 'error')
    },
    onDone: (p) => {
      installed()
      useProfiles.getState().setSelected(p.name)
      void useProfiles.getState().refresh()
      launch(p.name)
    },
  })
}
