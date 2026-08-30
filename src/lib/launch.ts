import { hasTauri } from '../ipc/tauri'
import { cancelLaunch, launchGame, launchProfile, quickPlay, pinServerDat, runningGames, discordPresence as ipcDiscordPresence } from '../ipc/commands'
import { listenLaunchProgress } from '../ipc/events'
import type { UnlistenFn } from '../ipc/tauri'
import type { LaunchAuth } from '../ipc/commands'
import { api, hasMillidaAccount } from './api'
import { joinPageUrl } from './invite'
import { beatStatus } from './presence'
import { effectiveNick, getAccount, launchAuthKind, profileSlug } from '../state/accounts'
import { ensureMsAuth, startMsLogin } from '../state/msLogin'
import { uiChoice, uiConfirm } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { setVerifiedSeconds } from '../state/playStats'
import { showToast, useUi } from '../state/ui'
import { useGame } from '../state/game'
import { applyLaunchWindowMode } from './window'
import { liveBeat, track, trackTimed } from './telemetry'

export const PL_STAGES = ['Проверка файлов', 'Java', 'Ассеты и библиотеки', 'Запуск игры']

export const REPAIR_STAGES = ['Файлы игры', 'Java', 'Ассеты и библиотеки', 'Моды и контент']

const STAGE_IDX: Record<string, number> = { files: 0, assets: 2, java: 1, launch: 3, mod: 0, content: 3 }

let session: { profile: string; server: string | null; serverName: string | null } | null = null
let sessionAt = 0

export const gameSession = () => session

export function setGameSession(profile: string | null, server?: string | null, serverName?: string | null) {
  session = profile ? { profile, server: server || null, serverName: serverName || null } : null
  sessionAt = profile ? Date.now() : 0
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(profile ? 'mc-started' : 'mc-stopped'))
}

/**
 * Куда игрок ушёл уже внутри игры: адрес приезжает из лога ядра, а не из
 * кнопки в лаунчере. Сессию правим на месте — «игра началась» второй раз не
 * случилось, поэтому событие mc-started здесь не шлётся.
 */
export function updateSessionServer(server: string | null, serverName: string | null) {
  if (!session) return
  if (session.server === server && session.serverName === serverName) return
  session = { ...session, server, serverName }
  heartbeat('playing')
}

/** Процесс успевает появиться в списке ядра не мгновенно — до этого верим сессии. */
const SESSION_GRACE_MS = 3 * 60 * 1000

/**
 * Сверка «в игре» с ядром: список процессов ведёт Rust, а не флаг во вьюхе.
 * Потерянное событие выхода раньше оставляло сессию навсегда — лаунчер в трее
 * продолжал бить «playing» и копить часы без запущенной игры.
 */
export async function reconcileGameSession(): Promise<void> {
  if (!session || launching) return
  // No core, no proof: a session that cannot be checked is dropped instead of
  // beating "playing" until the daily cap on the server side.
  if (!hasTauri()) {
    setGameSession(null)
    heartbeat('lobby')
    return
  }
  if (Date.now() - sessionAt < SESSION_GRACE_MS) return
  try {
    const list = (await runningGames()) || []
    useGame.getState().setList(list)
    if (!list.length) {
      setGameSession(null)
      heartbeat('lobby')
    }
  } catch {}
}

export const discordEnabled = () => localStorage.getItem('m-discord') !== '0'

/**
 * Показывается ли прямо сейчас активность Millida в Discord и на каком
 * аккаунте. Опыт за часы платится только за это время, поэтому сервер узнаёт
 * id из ответа ядра (READY-кадр сокета), а не со слов вьюхи.
 */
export function discordPresence(status?: string, server?: string | null): Promise<string> {
  if (!hasTauri() || !discordEnabled()) return Promise.resolve('')
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
  // Версия сборки уезжает в ссылку: принимающий лаунчер иначе знает только
  // адрес и заходит тем, что у гостя выбрано сейчас.
  const joinUrl = playing && addr ? joinPageUrl(addr, (session && session.serverName) || null, pack && pack.version) : ''
  return ipcDiscordPresence(details, state, playing, icon, build, joinUrl, profileSlug())
    .then((st) => (st && st.userId) || '')
    .catch(() => '')
}

/** Дольше этого удар присутствия не ждёт ответа сокета Discord. */
const PRESENCE_WAIT_MS = 2000

export function heartbeat(status?: string, server?: string | null) {
  const beat = beatStatus(status, !!session, hasTauri())
  if (beat === 'playing' && session && (!status || status === 'lobby'))
    server = session.serverName || session.server
  const playing = beat === 'playing'
  // Активность ставится до удара: сервер платит опыт за час, проведённый с
  // видимой активностью, и id её аккаунта должен уехать этим же ударом. Ждать
  // её дольше пары секунд нельзя: сокет Discord может висеть, а из-за него не
  // должны пропадать игровые часы — они дороже одной дискорд-минуты.
  const presence = Promise.race([
    discordPresence(beat, server),
    new Promise<string>((resolve) => setTimeout(() => resolve(''), PRESENCE_WAIT_MS)),
  ])
  if (hasMillidaAccount())
    presence.then((discordUserId) =>
      api('/friends/presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          status: beat,
          server: (playing && (server || (session && (session.serverName || session.server)))) || null,
          serverIp: (playing && session && session.server) || null,
          build: (playing && session && session.profile) || null,
          discordUserId: discordUserId || null,
        }),
      })
        .then((r: unknown) => setVerifiedSeconds((r as { verifiedSeconds?: number | null })?.verifiedSeconds ?? null))
        .catch(() => {}),
    )
  const build = (playing && session && session.profile) || null
  const pack = build ? useProfiles.getState().profiles.find((p) => p.name === build) : undefined
  void liveBeat(playing ? 'playing' : 'idle', {
    build,
    mc: (pack && pack.version) || null,
    server: (playing && (server || (session && (session.serverName || session.server)))) || null,
  })
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
  const kind = launchAuthKind(acc, hasMillidaAccount())
  // A live token is required, not just a stored one: Minecraft session tokens expire after a day.
  if (acc && kind === 'microsoft') {
    const ms = await ensureMsAuth(acc)
    if (ms) return { nick: acc.nick, auth: { kind: 'microsoft', accountId: ms.id, uuid: ms.uuid, xuid: ms.xuid } }
    const relogin = await uiChoice(
      'Вход по лицензии Microsoft истёк — сессия Minecraft больше не действует. Онлайн-серверы такой запуск не примут: игра скажет «Вы не вошли в свой аккаунт Minecraft». Войти заново?',
      {
        title: 'Лицензия не подтверждена',
        confirmLabel: 'Войти заново',
        cancelLabel: 'Играть офлайн',
        danger: false,
      },
    )
    if (relogin === 'yes') {
      void startMsLogin()
      throw new Error('Вход по лицензии Microsoft истёк — подтверди аккаунт и запусти игру снова')
    }
    if (relogin === 'dismiss') throw new Error('Запуск отменён')
    showToast('Играем офлайн: онлайн-серверы ответят «Вы не вошли в свой аккаунт Minecraft»')
    return offline
  }
  if (kind !== 'millida') return offline
  return { nick: offline.nick, auth: { kind: 'millida' } }
}

export function showLaunchError(e: unknown) {
  const msg = String(e && (e as Error).message ? (e as Error).message : e).replace(/^Error:\s*/, '')
  // A launch the user called off is not a failure and must not raise a red toast.
  if (/^Запуск отменён/.test(msg)) return
  showToast(/лиценз/i.test(msg) ? msg : 'Ошибка запуска: ' + msg, 'error')
}

let launching = false

/// doJoin resolves with the core's answer; this sentinel means the game was
/// never started, so callers must not report "заходим на сервер".
export const JOIN_SKIPPED = 'launch-skipped'

export const joinStarted = (res: unknown) => res !== JOIN_SKIPPED

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

export function joinWithAuth(
  profile: string,
  world: string | null,
  server: string | null,
  serverName?: string | null,
  opts?: { confirmed?: boolean },
) {
  if (launching) {
    showToast('Игра уже запускается')
    return Promise.resolve(JOIN_SKIPPED)
  }
  if (!opts?.confirmed && useGame.getState().list.length)
    return confirmSecondCopy(profile).then((ok) => (ok ? doJoin(profile, world, server, serverName) : JOIN_SKIPPED))
  return doJoin(profile, world, server, serverName)
}

function doJoin(profile: string, world: string | null, server: string | null, serverName?: string | null) {
  if (launching) {
    showToast('Игра уже запускается')
    return Promise.resolve(JOIN_SKIPPED)
  }
  // Same reason as in doLaunch: no core means no game and no way to notice it ended.
  if (!hasTauri()) return Promise.resolve(JOIN_SKIPPED)
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
  // Without the core there is no game process to watch: the session flag would
  // never be cleared, and every later beat reports "playing" forever. The server
  // measures those beats itself, so one stuck flag farms hours the player never
  // played (dark_eremite, 18.08.2026: 18 h counted locally against 70 h on the site).
  if (!hasTauri()) {
    launching = false
    return
  }
  try {
    setGameSession(name)
    heartbeat('playing')
  } catch {}
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
