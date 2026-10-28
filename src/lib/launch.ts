// The "Play" button: checks before launch, the core call, and what happens around the game. While the game runs, a presence pulse
// (/friends/presence/heartbeat) is sent for friends, and the status goes to Discord. Launch statistics: telemetry.ts.
import { hasTauri } from '../ipc/tauri'
import { PACK_ACCESS_PREFIX, cancelLaunch, launchGame, launchProfile, loadProfileSettings, quickPlay, pinServerDat, raiseRunning, runningGames, rememberBeat, setTrayLastBuild, discordPresence as ipcDiscordPresence, openAntivirusSettings, openGameFolder } from '../ipc/commands'
import { usePackKey } from '../state/packKey'
import { listenLaunchProgress } from '../ipc/events'
import type { UnlistenFn } from '../ipc/tauri'
import type { LaunchAuth } from '../ipc/commands'
import { api, hasMillidaAccount } from './api'
import { joinPageUrl } from './invite'
import { beatKey, beatStatus, presenceBeatDue } from './presence'
import { isPresenceTracked } from './realtime'
import { effectiveNick, getAccount, isMillidaKind, launchAuthKind, millidaGameNick, profileSlug } from '../state/accounts'
import { ensureMsAuth, startMsLogin } from '../state/msLogin'
import { uiChoice, uiConfirm } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { setVerifiedSeconds } from '../state/playStats'
import { showToast, useUi } from '../state/ui'
import { useGame } from '../state/game'
import { applyLaunchWindowMode } from './window'
import { setLaunchBusy, surfaceLaunchFailure } from './launchHold'
import { liveBeat, liveBeatPayload, trackFailure, trackTimed } from './telemetry'
import { launchAttribution } from './uiTrack'
import { failedHost } from './userEnvError'
import { buildTag } from './telemetryPrivacy'
import { launchFailure } from './launchFailure'
import { packStepForLaunch, runPackUpdateForLaunch } from './packLaunch'
import { afterRaise, notLaunched, notLaunchedNotice, prepareLaunch } from './launchPlan'
import { afterPackUpdate } from './packUpdate'
import { followFriendBuild } from './friendBuild'
import { adoptLegacyRam, pendingLegacyRamMb } from './ramPref'
import { rememberPlay } from './recentPlay'
import { requiresMillidaAuth, serverNeedsMillidaAuth } from './ownServer'
import { useServers } from '../state/servers'
import { publicServerLabel } from './liveServer'
import { NATIVE_NEEDS_MILLIDA, isNativeGame } from './nativeGame'
import { stopInstall } from '../state/installs'
import { holdLaunchForHdSkin } from './skinLock'
import { claimJoin } from './joinClaim'
import { t, tx } from '../i18n'
import { CORE_LAUNCH_CANCELLED, coreErrorText, mentionsCancel } from './coreErrors'
import { horizonReason } from './horizonError'

export { PL_STAGES, REPAIR_STAGES } from './launchView'

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
  // Discord shows this to people of every language, so it is English regardless of the UI language.
  const details = playing ? (build ? `Playing · ${build}` : 'In game') : 'In launcher'
  const addr = (session && session.server) || ''
  const place = (session && (session.serverName || session.server)) || server || ''
  const state = playing && place ? `Server: ${place}` : nick ? `Nick: ${nick}` : 'Millida Launcher'
  // Версия сборки уезжает в ссылку: принимающий лаунчер иначе знает только
  // адрес и заходит тем, что у гостя выбрано сейчас.
  const joinUrl = playing && addr ? joinPageUrl(addr, (session && session.serverName) || null, pack && pack.version) : ''
  return ipcDiscordPresence(details, state, playing, icon, build, joinUrl, profileSlug())
    .then((st) => (st && st.userId) || '')
    .catch(() => '')
}

/** Дольше этого удар присутствия не ждёт ответа сокета Discord. */
const PRESENCE_WAIT_MS = 2000

/// Ник, под которым друга видно в самой игре: у лицензии Microsoft он свой, и
/// без него список друзей называет человека именем, которого нет в игре.
/// Без аккаунта не спрашивается: `effectiveNick` выдумал бы нового «Player1234»
/// на каждый удар.
function gameNick(): string {
  const acc = getAccount()
  return acc && acc.nick ? effectiveNick() : ''
}

let sentBeat: string | null = null
let sendingBeat: string | null = null

/** The tray's «Играть» starts the build launched last. */
function rememberTrayBuild(profile: string) {
  if (!hasTauri() || !profile) return
  void Promise.resolve(setTrayLastBuild(profile)).catch((e) => console.warn('[launch] tray build was not remembered', e))
}

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
  const build = (playing && session && session.profile) || null
  const pack = build ? useProfiles.getState().profiles.find((p) => p.name === build) : undefined
  // Имя сборки придумал игрок — в телеметрию уходит слаг каталога или отпечаток.
  const slug = build && hasTauri() ? loadProfileSettings(build).catch(() => null) : Promise.resolve(null)
  const liveMeta = slug.then((st) => ({
    build: buildTag(build, st?.catalogPackSlug || st?.modpackSlug),
    mc: (pack && pack.version) || null,
    // Телеметрия живого онлайна: только сервер рейтинга или наш. Друзьям (ниже) уходит то, что человек им показывает.
    server: playing && session ? publicServerLabel(session.server, server || session.serverName, useServers.getState().list) : null,
  }))
  const catalogPack = slug.then((st) => (st?.catalogPackSlug || '').trim() || null)
  const liveStatus = playing ? 'playing' : 'idle'
  if (!hasMillidaAccount()) {
    void liveMeta.then((meta) => liveBeat(liveStatus, meta))
    return
  }
  // A signed-in launcher sends one request per beat: the launcher heartbeat rides inside
  // the presence one instead of going out as a second request.
  void Promise.all([presence, liveMeta, catalogPack])
    .then(async ([discordUserId, meta, catalogSlug]) => {
      const state = {
        status: beat,
        server: (playing && (server || (session && (session.serverName || session.server)))) || null,
        serverIp: (playing && session && session.server) || null,
        build: (playing && session && session.profile) || null,
        gameNick: (playing && gameNick()) || null,
        catalogPack: (playing && catalogSlug) || null,
        discordUserId: discordUserId || null,
      }
      // Without a window during the game the core repeats this beat (the socket
      // that carries presence otherwise is gone with the page).
      if (hasTauri()) void Promise.resolve(rememberBeat('/friends/presence/heartbeat', state)).catch((e) => console.warn('[launch] presence beat was not handed to the core', e))
      const key = beatKey(state)
      if (!presenceBeatDue(isPresenceTracked(), key, sentBeat, sendingBeat)) return
      sendingBeat = key
      try {
        const telemetry = await liveBeatPayload(liveStatus, meta).catch(() => null)
        const r = await api('/friends/presence/heartbeat', {
          method: 'POST',
          body: JSON.stringify({ ...state, ...(telemetry ? { telemetry } : {}) }),
        })
        sentBeat = key
        setVerifiedSeconds((r as { verifiedSeconds?: number | null })?.verifiedSeconds ?? null)
      } finally {
        if (sendingBeat === key) sendingBeat = null
      }
    })
    .catch(() => {})
}

/** A fresh socket has to hear the current state once, even when nothing changed since the last beat. */
export function beatAfterReconnect() {
  sentBeat = null
  heartbeat('lobby')
}

/** An explicit request wins over the build's own memory in the core; only a slider value older versions kept here is still one, until it moves. */
export function ramMbFor(profile: string): number {
  const legacy = pendingLegacyRamMb(profile)
  if (legacy) void adoptLegacyRam(profile)
  return legacy
}

/// Online servers verify the session either with Mojang (Microsoft licence) or with our
/// Yggdrasil server via authlib-injector; without either the game runs offline.
/// Only the account is named here — the core turns it into credentials.
async function resolveAuth(profile: string | null, server?: string | null): Promise<{ nick: string; auth: LaunchAuth }> {
  const acc = getAccount()
  const offline: { nick: string; auth: LaunchAuth } = { nick: effectiveNick(), auth: { kind: 'offline' } }
  const native = isNativeGame(useProfiles.getState().profiles.find((p) => p.name === profile))
  const smp = serverNeedsMillidaAuth(server)
  const millidaOnly = native || smp || (await profileNeedsMillidaAuth(profile))
  const kind = launchAuthKind(acc, hasMillidaAccount(), millidaOnly, millidaGameNick())
  if (millidaOnly) {
    const where = smp ? 'Millida SMP' : 'OneBlock'
    if (kind !== 'millida')
      throw new Error(native ? t(NATIVE_NEEDS_MILLIDA) : t('{where} пускает только с аккаунтом Millida: войди в Millida и нажми «Играть» ещё раз', { where }))
    if (!native && acc && !isMillidaKind(acc.kind)) showToast(t('{where}: заходим с аккаунтом Millida', { where }))
    return millidaAuth(offline.nick)
  }
  // A live token is required, not just a stored one: Minecraft session tokens expire after a day.
  if (acc && kind === 'microsoft') {
    const ms = await ensureMsAuth(acc)
    if (ms) return { nick: acc.nick, auth: { kind: 'microsoft', accountId: ms.id, uuid: ms.uuid, xuid: ms.xuid } }
    const relogin = await uiChoice(
      t('Вход по лицензии Microsoft истёк — сессия Minecraft больше не действует. Онлайн-серверы такой запуск не примут: игра скажет «Вы не вошли в свой аккаунт Minecraft». Войти заново?'),
      {
        title: t('Лицензия не подтверждена'),
        confirmLabel: t('Войти заново'),
        cancelLabel: t('Играть офлайн'),
        danger: false,
      },
    )
    if (relogin === 'yes') {
      void startMsLogin()
      throw new Error(t('Вход по лицензии Microsoft истёк — подтверди аккаунт и запусти игру снова'))
    }
    if (relogin === 'dismiss') throw new Error(CANCELLED_TEXT)
    showToast(t('Играем офлайн: онлайн-серверы ответят «Вы не вошли в свой аккаунт Minecraft»'))
    return offline
  }
  if (kind !== 'millida') return offline
  return millidaAuth(offline.nick)
}

/// The HD skin lives on the Millida profile, so only a Millida session carries it into the game.
async function millidaAuth(nick: string): Promise<{ nick: string; auth: LaunchAuth }> {
  if (await holdLaunchForHdSkin()) throw new Error(CANCELLED_TEXT)
  return { nick, auth: { kind: 'millida' } }
}

async function profileNeedsMillidaAuth(profile: string | null): Promise<boolean> {
  if (!profile || !hasTauri()) return false
  const st = await loadProfileSettings(profile).catch(() => null)
  return !!st && (requiresMillidaAuth(st.catalogPackSlug) || requiresMillidaAuth(st.modpackSlug))
}

/// The core names the antivirus in Russian; the match runs on the raw text, before translation.
const ANTIVIRUS_BLOCK = /антивирус/i

async function explainAntivirusBlock(raw: string) {
  const defender = /Microsoft Defender/.test(raw)
  const choice = await uiChoice(coreErrorText(raw), {
    title: t('Антивирус мешает запуску'),
    confirmLabel: defender ? t('Открыть защиту Windows') : t('Открыть папку игры'),
    cancelLabel: t('Закрыть'),
    danger: false,
  })
  if (choice !== 'yes' || !hasTauri()) return
  if (defender) await openAntivirusSettings().catch(() => openGameFolder())
  else await openGameFolder()
}

export function showLaunchError(e: unknown) {
  const msg = String(e && (e as Error).message ? (e as Error).message : e).replace(/^Error:\s*/, '')
  // A launch the user called off is not a failure and must not raise a red toast.
  if (/^Запуск отменён/.test(msg)) return
  surfaceLaunchFailure()
  if (ANTIVIRUS_BLOCK.test(msg)) {
    void explainAntivirusBlock(msg)
    return
  }
  showToast(/лиценз/i.test(msg) ? msg : t('Ошибка запуска: {error}', { error: tx(msg) }), 'error')
}

let launching = false
const setLaunching = (next: boolean) => {
  launching = next
  setLaunchBusy(next)
}
/// True from the moment Play is pressed until the core has answered: background work (the launcher's own
/// update download) waits for this to be over.
export const launchInProgress = () => launching
/// Растёт при каждом «Отменить»: запуск, который ещё ждал входа, по нему видит отмену и не зовёт ядро.
let cancelEpoch = 0
const CANCELLED_TEXT = CORE_LAUNCH_CANCELLED
/// Install key of the pack update this launch started; cancelling the launch cancels it too.
let updatingKey: string | null = null

/**
 * A catalogue build is brought to its published version before the game
 * starts, so players who only ever press Play still get the fixed build.
 * `openCard` shows the launch progress for paths that have no card of their own.
 */
async function freshenPack(profile: string, epoch: number, openCard: boolean): Promise<void> {
  await followFriendBuild(profile)
  if (epoch !== cancelEpoch) throw new Error(CANCELLED_TEXT)
  const step = await packStepForLaunch(profile)
  if (epoch !== cancelEpoch) throw new Error(CANCELLED_TEXT)
  if (step.kind === 'launch-unchecked') {
    showToast(t('Не удалось проверить обновление сборки: {reason}. Запускаем установленную версию', { reason: tx(step.reason) }))
    return
  }
  if (step.kind !== 'update') return
  const u = step.update
  const label = t('Обновляем сборку до {version}…', { version: u.to })
  const open = openCard ? { open: true, sub: profile, stage: 0, msg: null, mode: 'launch' as const } : {}
  useUi.getState().setPrelaunch({ ...open, label, pct: 0 })
  const job = runPackUpdateForLaunch(profile, u, (pct) => {
    if (epoch === cancelEpoch) useUi.getState().setPrelaunch({ pct })
  })
  if (job.own) updatingKey = job.key
  const outcome = await job.outcome.finally(() => {
    if (updatingKey === job.key) updatingKey = null
  })
  if (epoch !== cancelEpoch) throw new Error(CANCELLED_TEXT)
  useUi.getState().setPrelaunch(openCard ? { open: false, label: null } : { label: null, pct: 2, msg: t('Готовимся…') })
  const next = afterPackUpdate(u, outcome)
  if (next.toast) showToast(next.toast, 'error')
  if (!next.launch) {
    showToast(t('Обновление сборки отменено — игра не запускалась'))
    throw new Error(CANCELLED_TEXT)
  }
}

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
      ? t('Сборка «{name}» уже запущена. Вторая копия будет писать в те же миры — одиночный мир может испортиться. Запустить ещё раз?', { name: profile })
      : t('Уже запущена сборка «{running}». Запустить ещё и «{name}»? Игры поделят память компьютера.', { running: list[0] ?? '', name: profile }),
    {
      title: t('Игра уже запущена'),
      confirmLabel: t('Запустить ещё раз'),
      cancelLabel: t('Не запускать'),
      danger: same,
      rememberKey: same ? RELAUNCH_SAME_KEY : RELAUNCH_OTHER_KEY,
      rememberLabel: t('Больше не спрашивать'),
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
    showToast(t('Игра уже запускается'))
    return Promise.resolve(JOIN_SKIPPED)
  }
  const running = useGame.getState().list
  // A build that is already running is never asked about: the core raises its window.
  if (!opts?.confirmed && running.length && !running.includes(profile))
    return confirmSecondCopy(profile).then((ok) => (ok ? doJoin(profile, world, server, serverName) : JOIN_SKIPPED))
  return doJoin(profile, world, server, serverName)
}

function doJoin(profile: string, world: string | null, server: string | null, serverName?: string | null) {
  if (launching) {
    showToast(t('Игра уже запускается'))
    return Promise.resolve(JOIN_SKIPPED)
  }
  // Same reason as in doLaunch: no core means no game and no way to notice it ended.
  if (!hasTauri()) return Promise.resolve(JOIN_SKIPPED)
  setLaunching(true)
  const before = gameSession()
  setGameSession(profile, server, serverName)
  pinJoinedServer(profile, world ? null : server, serverName)
  heartbeat('playing', serverName || server)
  let stage = 'prepare'
  let unlisten: UnlistenFn | null = null
  let finished = false
  listenLaunchProgress((p) => {
    if (p.stage) stage = String(p.stage).slice(0, 24)
  }).then((u) => {
    if (!u) return
    if (finished) u()
    else unlisten = u
  })
  const stopProgress = () => {
    finished = true
    if (unlisten) unlisten()
    unlisten = null
  }
  const epoch = cancelEpoch
  const clickedAt = performance.now()
  return prepareLaunch({
    freshen: () => freshenPack(profile, epoch, true),
    care: () => Promise.resolve(),
    auth: () => resolveAuth(profile, server),
  })
    .then((a) => {
      if (epoch !== cancelEpoch) throw new Error(CANCELLED_TEXT)
      void claimJoin(server ?? null)
      return quickPlay(profile, a.nick, ramMbFor(profile), world, server, a.auth, Math.round(performance.now() - clickedAt))
    })
    .then((res) => {
      // The build was already running (or already starting): its window came forward, nothing new started.
      const not = notLaunched(res)
      if (not) {
        useGame.getState().addRunning(profile)
        // The session that was there is the truer one: it knows the server this game is on.
        if (before && before.profile === profile) setGameSession(before.profile, before.server, before.serverName)
        const say = notLaunchedNotice(not, { running: t('Игра уже запущена'), starting: t('Игра уже запускается') })
        if (say) showToast(say)
        return JOIN_SKIPPED
      }
      useGame.getState().addRunning(profile)
      rememberTrayBuild(profile)
      applyLaunchWindowMode()
      rememberPlay(profile, world, server, serverName)
      return res
    })
    .catch((e) => {
      if (epoch !== cancelEpoch) throw e
      setGameSession(null)
      heartbeat('lobby')
      if (String(e).includes(CANCELLED_TEXT)) throw e
      // Быстрый вход (мир / сервер) раньше не оставлял в телеметрии ничего.
      const fail = launchFailure(e, stage, [
        [profile, '<build>'],
        [world, '<world>'],
        [serverName, '<server>'],
        [server, '<addr>'],
        [effectiveNick(), '<nick>'],
      ])
      const pr = useProfiles.getState().profiles.find((p) => p.name === profile)
      trackFailure('join', fail.text, {
        stage: fail.stage,
        detail: fail.detail,
        target: world ? 'world' : server ? 'server' : 'build',
        mc: pr?.version,
        loader: pr ? pr.loader || (pr.fabric ? 'fabric' : 'vanilla') : undefined,
      })
      throw e
    })
    .finally(() => {
      stopProgress()
      if (epoch === cancelEpoch) setLaunching(false)
    })
}

/**
 * A quick join leaves no trace in the in-game list, so a player who drops out
 * has no way back. Both pins rewrite servers.dat, so they run one after
 * another: concurrent writes would lose one of the entries.
 */
function pinJoinedServer(profile: string, server: string | null, serverName?: string | null) {
  if (!server || !hasTauri()) {
    pinHostServer(profile)
    return
  }
  void pinServerDat(profile, serverName || server, server)
    .catch((e) => console.warn('[join] servers.dat', e))
    .finally(() => pinHostServer(profile))
}

export function pinHostServer(profile: string) {
  if (!hasTauri() || !profile) return
  if (isNativeGame(useProfiles.getState().profiles.find((p) => p.name === profile))) return
  try {
    const raw = localStorage.getItem('m-host-pin')
    if (!raw) return
    const { name, addr } = JSON.parse(raw) as { name?: string; addr?: string }
    if (addr) void pinServerDat(profile, name || t('Мой сервер'), addr).catch(() => {})
  } catch {}
}

export function realLaunch(name: string) {
  if (launching) {
    showToast(t('Игра уже запускается'))
    return
  }
  const running = useGame.getState().list
  if (running.length) {
    const prof = name || useProfiles.getState().selected || 'default'
    // The same build is never started twice: the core raises its window, so there is nothing to confirm
    // and nothing to prepare - no update of a pack that is in use, no graphics care, no sign-in.
    if (running.includes(prof)) {
      void raiseRunning(prof)
        .then((outcome) => {
          const after = afterRaise(outcome, { running: t('Игра уже запущена'), starting: t('Игра уже запускается') })
          if (after.launch) doLaunch(name)
          else if (after.notice) showToast(after.notice)
        })
        .catch(() => doLaunch(name))
      return
    }
    void confirmSecondCopy(prof).then((ok) => {
      if (ok) doLaunch(name)
    })
    return
  }
  doLaunch(name)
}

function doLaunch(name: string) {
  if (launching) {
    showToast(t('Игра уже запускается'))
    return
  }
  setLaunching(true)
  const launchStartedAt = performance.now()
  const sessionBefore = gameSession()
  const setPrelaunch = useUi.getState().setPrelaunch
  const pack = useProfiles.getState().profiles.find((p) => p.name === name)
  const ver = isNativeGame(pack) ? '' : pack ? (pack.version === 'latest' ? t('Minecraft последней версии') : 'Minecraft ' + pack.version) : t('Minecraft последней версии')
  setPrelaunch({ open: true, sub: ver ? name + ' · ' + ver : name, stage: 0, pct: 2, msg: t('Готовимся…'), mode: 'launch' })
  try {
    localStorage.setItem('m-last-' + name, String(Date.now()))
  } catch (e) {
    console.warn('[launch] last-played mark was not saved', e)
  }
  // Without the core there is no game process to watch: the session flag would
  // never be cleared, and every later beat reports "playing" forever. The server
  // measures those beats itself, so one stuck flag farms hours the player never
  // played (dark_eremite, 18.08.2026: 18 h counted locally against 70 h on the site).
  if (!hasTauri()) {
    setLaunching(false)
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
  // Этап, на котором запуск сорвался, уходит в телеметрию вместе с ошибкой.
  let lastStage = 'prepare'
  listenLaunchProgress((p) => {
    if (p.stage) lastStage = String(p.stage).slice(0, 24)
    setPrelaunch({ stage: STAGE_IDX[p.stage] ?? 0, pct: p.pct, msg: p.msg })
  }).then((u) => {
    if (!u) return
    if (finished) u()
    else unlisten = u
  })
  const prof = name || useProfiles.getState().selected
  const epoch = cancelEpoch
  // Sign-in runs next to the build's update and care instead of after them (launchPlan.ts).
  const inv = prepareLaunch({
    freshen: () => (prof ? freshenPack(prof, epoch, false) : Promise.resolve()),
    care: () => (prof ? import('./prelaunchCare').then((m) => m.prelaunchCare(prof)) : Promise.resolve()),
    auth: () => resolveAuth(prof || null),
  }).then((a) => {
    if (epoch !== cancelEpoch) throw new Error(CANCELLED_TEXT)
    void claimJoin(null)
    const prepMs = Math.round(performance.now() - launchStartedAt)
    return prof
      ? launchProfile(prof, a.nick, ramMbFor(prof), a.auth, prepMs)
      : launchGame('latest', a.nick, false, ramMbFor('default'), a.auth, prepMs)
  })
  const launched = prof ? useProfiles.getState().profiles.find((p) => p.name === prof) : null
  // Имя своей сборки — личное (аудит 24.09.2026): в событие идёт слаг каталога
  // или отпечаток имени.
  const launchInfo: Record<string, string> = {
    build: prof ? buildTag(prof) || 'default' : 'default',
    mc: (launched && launched.version) || 'latest',
    loader: (launched && (launched.loader || (launched.fabric ? 'fabric' : 'vanilla'))) || 'vanilla',
    ...launchAttribution('other'),
  }
  // Read when reported, not up front: the update before the launch changes the pack version.
  const packInfo = (): Promise<Record<string, string>> => prof
    ? loadProfileSettings(prof)
        .then((s) => {
          const pack = (s?.catalogPackSlug || '').trim()
          const out: Record<string, string> = {}
          if (pack) out.pack = pack
          if (pack) out.build = buildTag(prof, pack) || 'default'
          if (pack && s?.catalogPackVersion) out.packVersion = s.catalogPackVersion
          if (s?.modpackSlug) out.modpack = s.modpackSlug
          return out
        })
        .catch(() => ({}))
    : Promise.resolve({})
  inv
    .then((res) => {
      // The build was already running (or already starting): its window came forward, nothing new
      // started, so no launch is counted and no "game started" is announced.
      const not = notLaunched(res)
      if (not) {
        stopProgress()
        setPrelaunch({ open: false })
        if (not !== 'starting') useGame.getState().addRunning(prof || 'default')
        // The session that was there is the truer one: it knows the server this game is on.
        if (sessionBefore && sessionBefore.profile === name)
          setGameSession(sessionBefore.profile, sessionBefore.server, sessionBefore.serverName)
        const say = notLaunchedNotice(not, { running: t('Игра уже запущена'), starting: t('Игра уже запускается') })
        if (say) showToast(say)
        return
      }
      void packInfo().then((pack) => trackTimed('game_launch', launchStartedAt, { ...launchInfo, ...pack }))
      useGame.getState().addRunning(prof || 'default')
      if (prof) rememberTrayBuild(prof)
      window.dispatchEvent(new Event('millida-game-started'))
      setTimeout(() => {
        setPrelaunch({ open: false })
        showToast(t('Игра запущена'))
        applyLaunchWindowMode()
      }, 1200)
      stopProgress()
    })
    .catch((err) => {
      stopProgress()
      // The core unwinds a cancelled launch later, when the card and the flag
      // may already belong to the next launch.
      if (epoch !== cancelEpoch) return
      setPrelaunch({ open: false })
      setGameSession(null)
      if (mentionsCancel(err)) return
      const host = failedHost(err)
      const fail = launchFailure(err, lastStage, [
        [prof, '<build>'],
        [effectiveNick(), '<nick>'],
      ])
      // Ключи провала — первыми: старый сервер оставляет только первые 12.
      const failData = { code: fail.code, kind: fail.kind, stage: fail.stage }
      void packInfo().then((pack) => {
        trackTimed('game_launch', launchStartedAt, { ...failData, ...launchInfo, ...pack, ...(host ? { host } : {}) }, false)
        trackFailure('launch', fail.text, {
          stage: fail.stage,
          detail: fail.detail,
          mc: launchInfo.mc,
          loader: launchInfo.loader,
          pack: pack.pack,
        })
      })
      const text = String(err)
      const at = text.indexOf(PACK_ACCESS_PREFIX)
      if (at >= 0 && prof) {
        // The service refused a paid pack: the player gets the subscribe window, not a red error.
        const reason = text.slice(at + PACK_ACCESS_PREFIX.length)
        void packInfo().then((pack) => {
          if (pack.pack) usePackKey.getState().show(pack.pack, prof, reason, () => realLaunch(prof))
          else showLaunchError(err)
        })
        return
      }
      const horizon = prof ? horizonReason(err) : null
      if (horizon && prof) {
        surfaceLaunchFailure()
        void import('./horizon')
          .then((m) => m.offerJavaStart(prof, horizon, () => realLaunch(prof)))
          .catch(() => showLaunchError(err))
        return
      }
      showLaunchError(err)
    })
    .finally(() => {
      if (epoch === cancelEpoch) setLaunching(false)
    })
}

let plTimer: ReturnType<typeof setInterval> | null = null

export function startPrelaunch(name: string) {
  if (launchAuthKind(getAccount(), hasMillidaAccount(), false, millidaGameNick()) !== 'millida') return runPrelaunch(name)
  void holdLaunchForHdSkin().then((held) => {
    if (!held) runPrelaunch(name)
  })
}

function runPrelaunch(name: string) {
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
        showToast(t('Игра запущена — лаунчер свернётся'))
      }, 900)
      return
    }
    setPrelaunch({ stage, pct: prog })
  }, 260)
}

export function cancelPrelaunch() {
  cancelEpoch++
  if (plTimer) clearInterval(plTimer)
  const ui = useUi.getState()
  // A repair reports its own outcome once the core unwinds; announcing anything
  // here would race it with a second toast.
  const repair = ui.prelaunch.mode === 'repair'
  if (hasTauri()) cancelLaunch().catch((e) => console.warn('[launch] the core did not confirm the cancel', e))
  if (updatingKey) stopInstall(updatingKey)
  if (repair) {
    ui.setPrelaunch({ msg: t('Отменяем…') })
    return
  }
  ui.setPrelaunch({ open: false })
  setLaunching(false)
  showToast(t('Запуск отменён'))
}
