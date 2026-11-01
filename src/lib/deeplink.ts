import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { hasTauri } from '../ipc/tauri'
import { setScreen, showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { useServerDetail } from '../state/serverDetail'
import { useServers } from '../state/servers'
import { useLobby } from '../state/lobbyMode'
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
import { joinWithAuth, realLaunch, showLaunchError } from './launch'
import { shortcutTrusted } from '../ipc/commands'
import { restoreLauncher } from './window'
import { rememberInviteCode } from './referrals'
import { pickFriendsTab } from '../components/friends/friendsView'
import { parseInstallLink, parseOpenLink } from './millidaCatalog'
import { loadCatalogPacks } from '../components/playhub/data'
import { arcania2Live, arcaniaLead, isArcania2, isArcaniaLegacy } from './arcaniaRelease'
import { enterArcania } from '../components/arcania/transition'
import { installFromCatalog } from './catalogInstall'
import { openGameFromLink } from './gameInvite'
import { t } from '../i18n'
import { normalizePartyCode, partyCodeOk, prettyPartyCode } from './party'
import { joinPartyByCode } from '../state/party'
import { noted } from './noted'

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
    void uiConfirm(t('Запустить игру и зайти на сервер {server}?', { server: label }), {
      title: 'Millida',
      confirmLabel: t('Запустить'),
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
      showToast(t('Сборки «{name}» нет в лаунчере', { name: profile }), 'error')
      setScreen('builds')
      return
    }
    void uiConfirm(t('Запустить сборку «{name}»?', { name: profile }), {
      title: 'Millida',
      confirmLabel: t('Запустить'),
      danger: false,
    }).then((ok) => {
      if (ok) realLaunch(profile)
    })
    return
  }
  if (action === 'launch') {
    void launchFromShortcut(q.get('profile') || '', q.get('quickplay'), q.get('key') || '')
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
  // «Установить» на millida.net: материал каталога Millida по его slug.
  // millida://modpack/<slug> — прежняя кнопка сборок сайта, тот же каталог.
  if (action === 'install') {
    const link = parseInstallLink(action, rest, q)
    if (!link) {
      showToast(t('Ссылка на установку не распознана'), 'error')
      return
    }
    if (link.section === 'modpacks') setScreen('builds')
    else if (link.section !== 'skins' && link.section !== 'capes') setScreen('mods')
    void installFromCatalog(link.section, link.slug, {
      versions: link.versions,
      loaders: link.loaders,
      fromLink: true,
      name: link.name,
      slim: link.slim,
    }).catch((e) => showToast('' + e, 'error'))
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
    void uiConfirm(title === slug ? t('Установить сборку «{name}»?', { name: slug }) : t('Установить сборку «{name}» ({slug})?', { name: title, slug }), {
      title: 'Millida',
      confirmLabel: t('Установить'),
      danger: false,
    }).then((ok) => {
      if (ok) installPackFromLink(slug, title)
    })
    return
  }
  if (action === 'open') {
    const slug = parseOpenLink(rest)
    if (!slug) {
      showToast(t('Ссылка на сборку не распознана'), 'error')
      return
    }
    void openPackFromLink(slug)
    return
  }
  // millida.net/play/<slug> hands off here; the core alone decides whether the invite is valid.
  if (action === 'game') {
    const slug = rest.split('/')[0] || q.get('slug') || ''
    if (!slug) return
    openGameFromLink(slug, q.get('invite') || '')
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
  if (action === 'party') {
    const code = normalizePartyCode(rest || q.get('code') || '')
    if (!partyCodeOk(code)) return
    // Any web page can fire a millida:// link, and a party shares voice, so joining asks first.
    void uiConfirm(t('Вступить в пати {code}?', { code: prettyPartyCode(code) }), {
      title: 'Millida',
      confirmLabel: t('Вступить'),
      danger: false,
    }).then((ok) => {
      if (ok) void joinPartyByCode(code).catch(() => {})
    })
    return
  }
  if (action === 'invite') {
    rememberInviteCode(rest || q.get('code') || '')
    setScreen('friends')
    pickFriendsTab('invite')
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
        showToast(t('Позвонить по ссылке можно только другу'), 'error')
        return
      }
      const nick = friend.nickname || ''
      // Any web page can fire a millida:// link, so calling someone asks first.
      void uiConfirm(t('Позвонить {nick}?', { nick: nick || t('этому игроку') }), {
        title: 'Millida',
        confirmLabel: t('Позвонить'),
        danger: false,
      }).then((ok) => {
        if (ok) void callFriend(uid, nick).catch(() => {})
      })
    })
  }
}

/** `pending`: links the core kept while the window was unloaded; they replace the start link. */
export function initDeepLinks(pending?: string[]) {
  if (!hasTauri()) return
  if (pending) pending.forEach(handle)
  else
    void getCurrent()
      .then((urls) => (urls || []).forEach(handle))
      .catch(noted('deeplink-current'))
  void onOpenUrl((urls) => urls.forEach(handle)).catch(noted('deeplink-open'))
}

/// millida://launch?profile=…&quickplay=world:<folder>|server:<addr>&key=… —
/// a desktop shortcut. Its key proves the shortcut was made on this computer;
/// a link without it asks first, like every other link that starts the game.
async function launchFromShortcut(profile: string, quickplay: string | null, key: string): Promise<void> {
  if (!useProfiles.getState().profiles.some((p) => p.name === profile)) {
    showToast(t('Сборки «{name}» нет в лаунчере', { name: profile }), 'error')
    setScreen('builds')
    return
  }
  const world = quickplay && quickplay.startsWith('world:') ? quickplay.slice(6) : null
  const server = quickplay && quickplay.startsWith('server:') ? quickplay.slice(7) : null
  const trusted = !!key && (await shortcutTrusted(key, profile, quickplay).catch(() => false))
  if (!trusted) {
    const what = world ? t('мир «{name}»', { name: world }) : server ? t('сервер {addr}', { addr: server }) : null
    const ok = await uiConfirm(what ? t('Запустить сборку «{name}» и зайти в {target}?', { name: profile, target: what }) : t('Запустить сборку «{name}»?', { name: profile }), {
      title: 'Millida',
      confirmLabel: t('Запустить'),
      danger: false,
    })
    if (!ok) return
  }
  if (world || server) joinWithAuth(profile, world, server, server).catch((e) => showLaunchError(e))
  else realLaunch(profile)
}

function installPackFromLink(slug: string, title: string): void {
  runInstall({
    key: keyCatalogPack(slug),
    title,
    running: t('Скачивание…'),
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
      showToast(t('Сборка «{name}» готова к запуску', { name: p.name }), 'ok', 'achievement')
    },
  })
}

/// millida://open/<slug> from millida.net: the pack's page in PlayHub. It only shows a page, so it needs no
/// confirmation, but the slug must be a pack the catalog actually lists, or PlayHub would wait for it forever.
async function openPackFromLink(requested: string): Promise<void> {
  const live = arcania2Live()
  const slug = isArcaniaLegacy(requested, live) ? arcaniaLead(live) : requested
  const packs = await loadCatalogPacks()
  const premium = useLobby.getState().premium
  const known = packs.some((p) => p.slug === slug) || premium.some((p) => (p.slug || p.id) === slug)
  if (!known) {
    showToast(packs.length ? t('Сборки «{name}» нет в каталоге Millida', { name: slug }) : t('Каталог не ответил — повтори'), 'error')
    return
  }
  const open = () => {
    useLobby.setState({ hubTarget: { pack: slug } })
    setScreen('playhub')
  }
  if (isArcania2(slug, live)) enterArcania(open)
  else open()
}
