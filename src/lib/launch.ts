import { hasTauri } from '../ipc/tauri'
import { cancelLaunch, launchGame, launchProfile, quickPlay, pinServerDat, discordPresence as ipcDiscordPresence } from '../ipc/commands'
import { listenLaunchProgress } from '../ipc/events'
import type { UnlistenFn } from '../ipc/tauri'
import type { LaunchAuth } from '../ipc/commands'
import { api, hasMillidaAccount } from './api'
import { joinPageUrl } from './invite'
import { effectiveNick, getAccount } from '../state/accounts'
import { ensureMsAuth, startMsLogin } from '../state/msLogin'
import { uiConfirm } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { showToast, useUi } from '../state/ui'
import { useGame } from '../state/game'
import { applyLaunchWindowMode } from './window'
import { liveBeat, track, trackTimed } from './telemetry'

export const PL_STAGES = ['Проверка файлов', 'Java 21 (в комплекте)', 'Ассеты и библиотеки', 'Запуск игры']

export const REPAIR_STAGES = ['Файлы игры', 'Java', 'Ассеты и библиотеки', 'Моды и контент']

const STAGE_IDX: Record<string, number> = { files: 0, assets: 2, java: 1, launch: 3, mod: 0, content: 3 }

let session: { profile: string; server: string | null; serverName: string | null } | null = null

export const gameSession = () => session

export function setGameSession(profile: string | null, server?: string | null, serverName?: string | null) {
  session = profile ? { profile, server: server || null, serverName: serverName || null } : null
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(profile ? 'mc-started' : 'mc-stopped'))
}

export const discordEnabled = () => localStorage.getItem('m-discord') !== '0'

export function discordPresence(status?: string, server?: string | null) {
  if (!hasTauri() || !discordEnabled()) return
  const playing = status === 'playing'
  const nick = (getAccount() || { nick: '' }).nick || ''
  const build = session ? session.profile : ''
  const pack = build ? useProfiles.getState().profiles.find((p) => p.name === build) : undefined
  // Discord only proxies https images; data: and local paths are silently ignored.
  const icon = pack && pack.icon && pack.icon.startsWith('https://') ? pack.icon : ''
  const details = playing ? (build ? 'Играет · ' + build : 'В игре') : 'В лаунчере'
  const addr = (session && session.server) || ''
  const place = (session && (session.serverName || session.server)) || server || ''
  const state = playing && place ? 'Сервер: ' + place : nick ? 'Ник: ' + nick : 'Millida Launcher'
  const joinUrl = playing && addr ? joinPageUrl(addr, (session && session.serverName) || null) : ''
  ipcDiscordPresence(details, state, playing, icon, build, joinUrl).catch(() => {})
}

export function heartbeat(status?: string, server?: string | null) {
  if (session && (!status || status === 'lobby')) {
    status = 'playing'
    server = session.serverName || session.server
  }
  const playing = status === 'playing'
  if (hasMillidaAccount())
    api('/friends/presence/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        status: status || 'lobby',
        server: (playing && (server || (session && (session.serverName || session.server)))) || null,
        serverIp: (playing && session && session.server) || null,
        build: (playing && session && session.profile) || null,
      }),
    }).catch(() => {})
  const build = (playing && session && session.profile) || null
  const pack = build ? useProfiles.getState().profiles.find((p) => p.name === build) : undefined
  void liveBeat(playing ? 'playing' : 'idle', {
    build,
    mc: (pack && pack.version) || null,
    server: (playing && (server || (session && (session.serverName || session.server)))) || null,
  })
  discordPresence(status, server)
}

export function ramMbFor(profile: string): number {
  const gb = parseInt(localStorage.getItem('m-ram-' + profile) || '0', 10)
  return gb > 0 ? gb * 1024 : 0
}

/// Online servers verify the session either with Mojang (Microsoft licence) or with our
/// Yggdrasil server via authlib-injector; without either the game runs offline.
/// Only the account is named here — the core turns it into credentials.
async function resolveAuth(): Promise<{ nick: string; auth: LaunchAuth }> {
  const acc = getAccount()
  const offline: { nick: string; auth: LaunchAuth } = { nick: effectiveNick(), auth: { kind: 'offline' } }
  // A live token is required, not just a stored one: Minecraft session tokens expire after a day.
  if (acc && acc.kind === 'microsoft') {
    const ms = await ensureMsAuth(acc)
    if (ms) return { nick: acc.nick, auth: { kind: 'microsoft', accountId: ms.id, uuid: ms.uuid, xuid: ms.xuid } }
    const relogin = await uiConfirm(
      'Вход по лицензии Microsoft истёк — сессия Minecraft больше не действует. Онлайн-серверы такой запуск не примут: игра скажет «Вы не вошли в свой аккаунт Minecraft». Войти заново?',
      {
        title: 'Лицензия не подтверждена',
        confirmLabel: 'Войти заново',
        cancelLabel: 'Играть офлайн',
        danger: false,
      },
    )
    if (relogin) {
      void startMsLogin()
      throw new Error('Вход по лицензии Microsoft истёк — подтверди аккаунт и запусти игру снова')
    }
    showToast('Играем офлайн: онлайн-серверы ответят «Вы не вошли в свой аккаунт Minecraft»')
    return offline
  }
  if (!hasMillidaAccount()) return offline
  return { nick: offline.nick, auth: { kind: 'millida' } }
}

export function showLaunchError(e: unknown) {
  const msg = String(e && (e as Error).message ? (e as Error).message : e).replace(/^Error:\s*/, '')
  showToast(/лиценз/i.test(msg) ? msg : 'Ошибка запуска: ' + msg, 'error')
}

let launching = false

const RELAUNCH_SAME_KEY = 'relaunch-same-build'
const RELAUNCH_OTHER_KEY = 'relaunch-other-build'

/// A second copy is allowed, but the user must see what they are getting into:
/// the same build shares its saves between both processes.
function confirmSecondCopy(profile: string): Promise<boolean> {
  const list = useGame.getState().list
  if (!list.length) return Promise.resolve(true)
  const same = list.includes(profile)
  return uiConfirm(
    same
      ? 'Сборка «' +
          profile +
          '» уже запущена. Вторая копия будет писать в те же миры — одиночный мир может испортиться. Запустить ещё раз?'
      : 'Уже запущена сборка «' + list[0] + '». Запустить ещё и «' + profile + '»? Игры поделят память компьютера.',
    {
      title: 'Игра уже запущена',
      confirmLabel: 'Запустить ещё раз',
      cancelLabel: 'Не запускать',
      danger: same,
      rememberKey: same ? RELAUNCH_SAME_KEY : RELAUNCH_OTHER_KEY,
      rememberLabel: 'Больше не спрашивать',
    },
  )
}

export function joinWithAuth(profile: string, world: string | null, server: string | null, serverName?: string | null) {
  if (launching) {
    showToast('Игра уже запускается')
    return Promise.resolve('busy')
  }
  if (useGame.getState().list.length)
    return confirmSecondCopy(profile).then((ok) => (ok ? doJoin(profile, world, server, serverName) : 'busy'))
  return doJoin(profile, world, server, serverName)
}

function doJoin(profile: string, world: string | null, server: string | null, serverName?: string | null) {
  if (launching) {
    showToast('Игра уже запускается')
    return Promise.resolve('busy')
  }
  launching = true
  setGameSession(profile, server, serverName)
  pinHostServer(profile)
  heartbeat('playing', serverName || server)
  return resolveAuth()
    .then((a) => quickPlay(profile, a.nick, ramMbFor(profile), world, server, a.auth))
    .then((res) => {
      useGame.getState().addRunning(profile)
      applyLaunchWindowMode()
      return res
    })
    .catch((e) => {
      setGameSession(null)
      heartbeat('lobby')
      throw e
    })
    .finally(() => {
      launching = false
    })
}

export function pinHostServer(profile: string) {
  if (!hasTauri() || !profile) return
  try {
    const raw = localStorage.getItem('m-host-pin')
    if (!raw) return
    const { name, addr } = JSON.parse(raw) as { name?: string; addr?: string }
    if (addr) void pinServerDat(profile, name || 'Мой сервер', addr).catch(() => {})
  } catch {}
}

export function realLaunch(name: string) {
  if (launching) {
    showToast('Игра уже запускается')
    return
  }
  if (useGame.getState().list.length) {
    const prof = name || useProfiles.getState().selected || 'default'
    void confirmSecondCopy(prof).then((ok) => {
      if (ok) doLaunch(name)
    })
    return
  }
  doLaunch(name)
}

function doLaunch(name: string) {
  if (launching) {
    showToast('Игра уже запускается')
    return
  }
  launching = true
  const setPrelaunch = useUi.getState().setPrelaunch
  const pack = useProfiles.getState().profiles.find((p) => p.name === name)
  const ver = pack ? (pack.version === 'latest' ? 'Minecraft последней версии' : 'Minecraft ' + pack.version) : 'Minecraft последней версии'
  setPrelaunch({ open: true, sub: name + ' · ' + ver, stage: 0, pct: 2, msg: 'Готовимся…', mode: 'launch' })
  try {
    localStorage.setItem('m-last-' + name, String(Date.now()))
  } catch {}
  try {
    setGameSession(name)
    heartbeat('playing')
  } catch {}
  if (!hasTauri()) {
    launching = false
    return
  }
  pinHostServer(name || useProfiles.getState().selected || '')
  // The subscription can resolve after the launch finished; unsubscribe explicitly or it leaks.
  let unlisten: UnlistenFn | null = null
  let finished = false
  const stopProgress = () => {
    finished = true
    if (unlisten) unlisten()
    unlisten = null
  }
  listenLaunchProgress((p) => {
    setPrelaunch({ stage: STAGE_IDX[p.stage] ?? 0, pct: p.pct, msg: p.msg })
  }).then((u) => {
    if (!u) return
    if (finished) u()
    else unlisten = u
  })
  const prof = name || useProfiles.getState().selected
  const inv = resolveAuth().then((a) =>
    prof
      ? launchProfile(prof, a.nick, ramMbFor(prof), a.auth)
      : launchGame('latest', a.nick, false, ramMbFor('default'), a.auth),
  )
  const launchStartedAt = performance.now()
  const launched = prof ? useProfiles.getState().profiles.find((p) => p.name === prof) : null
  const launchInfo = {
    build: prof || 'default',
    mc: (launched && launched.version) || 'latest',
    loader: (launched && (launched.loader || (launched.fabric ? 'fabric' : 'vanilla'))) || 'vanilla',
  }
  inv
    .then(() => {
      trackTimed('game_launch', launchStartedAt, launchInfo)
      useGame.getState().addRunning(prof || 'default')
      window.dispatchEvent(new Event('millida-game-started'))
      setTimeout(() => {
        setPrelaunch({ open: false })
        showToast('Игра запущена')
        applyLaunchWindowMode()
      }, 1200)
      stopProgress()
    })
    .catch((err) => {
      stopProgress()
      setPrelaunch({ open: false })
      setGameSession(null)
      if (String(err).includes('отмен')) return
      trackTimed('game_launch', launchStartedAt, { ...launchInfo, code: String(err).slice(0, 120) }, false)
      track('error', { code: String(err).slice(0, 120), where: 'launch' }, { ok: false })
      showLaunchError(err)
    })
    .finally(() => {
      launching = false
    })
}

let plTimer: ReturnType<typeof setInterval> | null = null

export function startPrelaunch(name: string) {
  const setPrelaunch = useUi.getState().setPrelaunch
  let stage = 0
  let prog = 0
  setPrelaunch({ open: true, sub: name, stage, pct: prog, msg: null, mode: 'launch' })
  if (plTimer) clearInterval(plTimer)
  plTimer = setInterval(() => {
    prog += Math.random() * 7 + 3
    if (prog >= (stage + 1) * 25) stage = Math.min(stage + 1, 3)
    if (prog >= 100) {
      prog = 100
      stage = 4
      setPrelaunch({ stage, pct: prog })
      if (plTimer) clearInterval(plTimer)
      setTimeout(() => {
        setPrelaunch({ open: false })
        showToast('Игра запущена — лаунчер свернётся')
      }, 900)
      return
    }
    setPrelaunch({ stage, pct: prog })
  }, 260)
}

export function cancelPrelaunch() {
  if (plTimer) clearInterval(plTimer)
  const ui = useUi.getState()
  // A repair reports its own outcome once the core unwinds; announcing anything
  // here would race it with a second toast.
  const repair = ui.prelaunch.mode === 'repair'
  if (hasTauri()) cancelLaunch().catch(() => {})
  if (repair) {
    ui.setPrelaunch({ msg: 'Отменяем…' })
    return
  }
  ui.setPrelaunch({ open: false })
  launching = false
  showToast('Запуск отменён')
}
