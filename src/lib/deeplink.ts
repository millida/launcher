import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { hasTauri } from '../ipc/tauri'
import { setScreen, showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { useServerDetail } from '../state/serverDetail'
import { useServers } from '../state/servers'
import { useMods } from '../state/mods'
import { openProject } from '../state/project'
import { setNewBuildPreset } from '../state/newBuild'
import { openModal } from '../state/ui'
import { useProfiles } from '../state/profiles'
import { usePackCode } from '../state/packCode'
import { runInstall } from '../state/installs'
import { PACK_ACCESS_PREFIX, installCatalogPack } from '../ipc/commands'
import { usePackKey } from '../state/packKey'
import { keyCatalogPack } from './installKeys'
import { useFriends, openChatFromLink, loadFriends } from '../state/friends'
import { callFriend } from '../state/call'
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
    // Any web page can fire a millida:// link, so starting the game and joining
    // someone else's server asks first. Имя приходит из ссылки и может врать —
    // поэтому рядом всегда настоящий адрес, а запоминаем имя только после «да».
    const label = name === addr ? `«${addr}»` : `«${name}» (${addr})`
    void uiConfirm(`Запустить игру и зайти на сервер ${label}?`, {
      title: 'Millida',
      confirmLabel: 'Запустить',
      danger: false,
    }).then((ok) => {
      if (!ok) return
      rememberServerName(addr, name)
      void quickJoin(addr, name, q.get('licensed') === '1', q.getAll('version')).catch(() => {})
    })
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
    void uiConfirm(`Запустить сборку «${profile}»?`, {
      title: 'Millida',
      confirmLabel: 'Запустить',
      danger: false,
    }).then((ok) => {
      if (ok) realLaunch(profile)
    })
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
  if (action === 'pack') {
    const code = rest || q.get('code') || ''
    if (!code) return
    setScreen('builds')
    usePackCode.getState().show(code)
    return
  }
  // Готовая сборка каталога: сайт не отдаёт её файлом, установка живёт только
  // здесь. Как и «join», ссылку может открыть любая страница, поэтому спрашиваем
  // до того, как качать гигабайты.
  if (action === 'modpack') {
    const slug = rest || q.get('slug') || ''
    if (!slug) return
    setScreen('builds')
    const title = q.get('name') || slug
    void uiConfirm(title === slug ? `Установить сборку «${slug}»?` : `Установить сборку «${title}» (${slug})?`, {
      title: 'Millida',
      confirmLabel: 'Установить',
      danger: false,
    }).then((ok) => {
      if (ok) installPackFromLink(slug, title)
    })
    return
  }
  if (action === 'skins') {
    setScreen('skins')
    return
  }
  if (action === 'friends') {
    setScreen('friends')
    return
  }
  // The website hands off to the launcher for anything the browser cannot do:
  // opening a specific conversation and placing a call. Without a target id
  // these fall back to the friends screen rather than doing nothing.
  if (action === 'chat') {
    const uid = rest || q.get('user') || ''
    setScreen('friends')
    if (uid) void openChatFromLink(uid).catch(() => {})
    return
  }
  if (action === 'call') {
    const uid = rest || q.get('user') || ''
    setScreen('friends')
    if (!uid) return
    // Звоним только друзьям и называем их по нику из списка друзей: ник из
    // ссылки мог подсунуть кто угодно (аудит 24.09.2026).
    const find = () => useFriends.getState().friends.find((f) => f.userId === uid)
    // При холодном старте список друзей ещё не загружен.
    void (find() ? Promise.resolve() : loadFriends().catch(() => {})).then(() => {
      const friend = find()
      if (!friend) {
        showToast('Позвонить по ссылке можно только другу', 'error')
        return
      }
      const nick = friend.nickname || ''
      // Any web page can fire a millida:// link, so calling someone asks first.
      void uiConfirm(`Позвонить ${nick || 'этому игроку'}?`, {
        title: 'Millida',
        confirmLabel: 'Позвонить',
        danger: false,
      }).then((ok) => {
        if (ok) void callFriend(uid, nick).catch(() => {})
      })
    })
  }
}

export function initDeepLinks() {
  if (!hasTauri()) return
  void getCurrent()
    .then((urls) => (urls || []).forEach(handle))
    .catch(() => {})
  void onOpenUrl((urls) => urls.forEach(handle)).catch(() => {})
}

function installPackFromLink(slug: string, title: string): void {
  runInstall({
    key: keyCatalogPack(slug),
    title,
    running: 'Скачивание…',
    run: () => installCatalogPack(slug),
    onError: (e) => {
      const text = String(e)
      if (text.startsWith(PACK_ACCESS_PREFIX)) {
        usePackKey.getState().show(slug, title, text.slice(PACK_ACCESS_PREFIX.length), () => installPackFromLink(slug, title))
        return
      }
      showToast(text, 'error')
    },
    onDone: (p) => {
      useProfiles.getState().setSelected(p.name)
      void useProfiles.getState().refresh()
      showToast('Сборка «' + p.name + '» готова к запуску', 'ok', 'achievement')
    },
  })
}
