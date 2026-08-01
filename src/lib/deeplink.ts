import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { hasTauri } from '../ipc/tauri'
import { setScreen, showToast } from '../state/ui'
import { useServerDetail } from '../state/serverDetail'
import { useServers } from '../state/servers'
import { useMods } from '../state/mods'
import { openProject } from '../state/project'
import { setNewBuildPreset } from '../state/newBuild'
import { openModal } from '../state/ui'
import { useProfiles } from '../state/profiles'
import { rememberServerName } from '../state/playStats'
import { quickJoin } from './joinServer'
import { realLaunch } from './launch'
import { restoreLauncher } from './window'

function handle(raw: string) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return
  }
  if (url.protocol !== 'millida:') return
  restoreLauncher()
  // For millida://join/<host> the host lands in `hostname`, the rest in `pathname`.
  const action = url.hostname || url.pathname.replace(/^\/+/, '').split('/')[0] || ''
  const rest = url.pathname.replace(/^\/+/, '')
  const q = url.searchParams

  if (action === 'join') {
    const addr = rest || q.get('addr') || ''
    if (!addr) return
    const name = q.get('name') || addr
    rememberServerName(addr, name)
    void quickJoin(addr, name, q.get('licensed') === '1').catch(() => {})
    return
  }
  if (action === 'server') {
    setScreen('servers')
    const slug = rest || q.get('slug') || ''
    const found = useServers.getState().list.find((s) => s.slug === slug)
    if (found) useServerDetail.getState().open(found)
    return
  }
  if (action === 'hosting') {
    setScreen('hosting')
    return
  }
  if (action === 'play') {
    const profile = decodeURIComponent(rest || q.get('build') || '')
    const exists = useProfiles.getState().profiles.some((p) => p.name === profile)
    if (!exists) {
      showToast('Сборки «' + profile + '» нет в лаунчере', 'error')
      setScreen('builds')
      return
    }
    realLaunch(profile)
    return
  }
  if (action === 'build') {
    setNewBuildPreset({
      version: q.get('version') || undefined,
      loader: q.get('loader') || undefined,
      name: q.get('name') || undefined,
    })
    setScreen('builds')
    openModal('nbModal')
    return
  }
  if (action === 'project') {
    const slug = rest || q.get('slug') || ''
    if (!slug) return
    setScreen('mods')
    useMods.getState().scopeTo(null)
    void openProject(slug, q.get('type') === 'modpack' ? 'modpack' : 'mod')
    return
  }
  if (action === 'skins') {
    setScreen('skins')
    return
  }
  if (action === 'friends') {
    setScreen('friends')
  }
}

export function initDeepLinks() {
  if (!hasTauri()) return
  void getCurrent()
    .then((urls) => (urls || []).forEach(handle))
    .catch(() => {})
  void onOpenUrl((urls) => urls.forEach(handle)).catch(() => {})
}
