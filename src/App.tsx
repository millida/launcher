import { Suspense, lazy, useEffect } from 'react'
import { SvgSprite } from './components/SvgSprite'
import { Titlebar } from './components/Titlebar'
import { HubTopTabs, Sidebar } from './components/Sidebar'
import { useLayout } from './state/layout'
import type { ScreenId } from './state/ui'
import { LaunchToast, Toast } from './components/Toast'
import { initChatScreen } from './state/chatScreen'
// Screens are mounted only while open, and their chunks are prewarmed after boot
// so switching tabs stays instant.
import {
  Builds,
  ClassicHome,
  Friends,
  Top,
  Hosting,
  Messages,
  Mods,
  PlayHub,
  Pvp,
  Play,
  Premium,
  Plus,
  Rubies,
  Servers,
  Settings,
  Skins,
  preloadScreens,
} from './screens/registry'
// Раскладка «Классика» — выбор в настройках, у остальных её код не нужен.
const ClassicSidebar = lazy(() => import('./components/ClassicSidebar').then((m) => ({ default: m.ClassicSidebar })))
const InstancePage = lazy(() => import('./modals/InstancePage').then((m) => ({ default: m.InstancePage })))
const ChestOpenHost = lazy(() => import('./components/daily/ChestOpen').then((m) => ({ default: m.ChestOpenHost })))
// Kept out of the startup bundle: most sessions never open them, and each is mounted
// on its first opening and stays mounted so the closing transition still plays.
const ProjectModal = lazy(() => import('./modals/Project').then((m) => ({ default: m.ProjectModal })))
const NewBuildModal = lazy(() => import('./modals/NewBuild').then((m) => ({ default: m.NewBuildModal })))
const OnboardingModal = lazy(() => import('./modals/Onboarding').then((m) => ({ default: m.OnboardingModal })))
import { gameStepPending, hasGameAccount, useFirstRun } from './state/firstRun'
import { ImageLightbox } from './components/ImageLightbox'
import { UpdateBanner } from './components/UpdateBanner'
import { PartyHost } from './components/party/PartyHost'
import { ChatNotify } from './components/ChatNotify'
import {
  AccountAddModal,
  BuildPicker,
  BuyModal,
  CallPanel,
  CommandPalette,
  ConfirmModal,
  CrashModal,
  DepPlanModal,
  ImportModal,
  Login,
  MigrateBuildModal,
  LiveLog,
  MilliDock,
  ModpackVersionsOverlay,
  MoveBuildsModal,
  PackCodeHost,
  PackKeyHost,
  PixelTip,
  PlayhubBar,
  RewardHost,
  RoomModals,
  ScreenshotsOverlay,
  ServerDetail,
  Tour,
} from './components/hosts'
import { Installs } from './components/Installs'
import { PackDrop } from './components/PackDrop'
import { initInstalls, useInstalls } from './state/installs'
import { syncNativeTexts } from './lib/nativeTexts'
import { initCalls } from './state/call'
import { loadProfileSettings } from './ipc/commands'
import { pushChatNotify } from './state/chatNotify'
import { notifyAudible, notifyShown } from './state/notifyPrefs'
import { createPresenceMemo, presenceEvents, presenceText, presenceTitle } from './state/presenceNotify'
import { initDesktopToasts, showAwayCard, showDesktopToast } from './lib/desktopToast'
import { parseInvite } from './lib/invite'
import { parseCallLog } from './lib/call/callLog'
import { markPreview, parseMark } from './lib/waypointShare'
import { effectiveNick, getAccount, getMillidaAccount, useAccounts } from './state/accounts'
import { markMillidaEver, useOnboarding } from './state/onboarding'
import { useEverTrue } from './lib/everTrue'
import { initAccent } from './lib/accent'
import { initDensity } from './lib/density'
import { refreshGameNick } from './state/gameNick'
import { warmHeads } from './lib/heads'
import { Guard } from './components/Guard'
import { useUi, closeModal, setScreen as gotoScreen, showToast } from './state/ui'
import { modalToClose, openLayers } from './lib/escClose'
import { useWallpaper } from './state/wallpaper'
import { loadLiveRating } from './state/servers'
import { appendChatMessage, applyChatMessage, applyTypingPush, loadFriends, openRoomChat, useFriends } from './state/friends'
import { bumpRoom, loadRooms, nickInRooms, roomById, useRooms, type VoiceMember } from './state/rooms'
import type {
  ChatAttachment,
  ChatMessage,
  ChatReaction,
  ChatReplyPreview,
  Friend,
  FriendRequest,
} from './state/friends'

interface PolledMessage {
  id?: string
  from: string
  fromNick?: string
  text?: string
  ts?: number
  attachment?: ChatAttachment | null
  replyTo?: ChatReplyPreview | null
  reactions?: ChatReaction[]
}

/// Правка, удаление и реакция приходят целым сообщением с пометкой, чья это
/// переписка: применяем только к открытой, остальное подтянет её загрузка.
type PolledUpdate = ChatMessage & { peer: string }

interface PolledRead {
  userId: string
  readAt: number
}

type PolledRoomMessage = PolledMessage & { roomId: string; id?: string; deleted?: boolean }

interface RoomPoll {
  roomMessages?: PolledRoomMessage[]
  roomUpdates?: PolledRoomMessage[]
  roomTyping?: { roomId: string; users: string[] }[]
  roomVoice?: { roomId: string; members: VoiceMember[] }[]
}

/**
 * Дельта групп из общего опроса. Открытая группа получает сообщение в ленту,
 * закрытая — счётчик и карточку уведомления: то же поведение, что у лички,
 * потому что человеку всё равно, откуда пришло сообщение.
 */
function applyRoomPoll(r: RoomPoll) {
  const rooms = useRooms.getState()
  ;(r.roomMessages || []).forEach((m) => {
    const f = useFriends.getState()
    const open = f.chatOpen && f.chatRoom === m.roomId
    if (open) {
      appendChatMessage({
        id: m.id,
        text: String(m.text || ''),
        ts: m.ts,
        from: m.from,
        fromNick: m.fromNick,
        attachment: m.attachment || null,
        replyTo: m.replyTo || null,
        reactions: m.reactions || [],
      })
      if (notifyAudible('room')) playSound('notify')
      void api('/friends/rooms/' + encodeURIComponent(m.roomId) + '/read', { method: 'POST' }).catch(() => {})
      bumpRoom(m.roomId, m.ts || Date.now(), false)
      return
    }
    bumpRoom(m.roomId, m.ts || Date.now(), true)
    const title = roomById(m.roomId)?.title || t('Группа')
    const nick = m.fromNick || ''
    pushChatNotify({
      uid: m.roomId,
      nick: title,
      text: (nick ? nick + ': ' : '') + previewOf(m),
      kind: 'room',
      actionLabel: t('Открыть группу'),
      action: () => void openRoomChat(m.roomId, title),
    })
    if (notifyShown('room')) {
      const card = {
        uid: m.roomId,
        nick: title,
        text: (nick ? nick + ': ' : '') + previewOf(m),
        ts: m.ts || Date.now(),
        kind: 'msg' as const,
        open: 'room' as const,
      }
      showAwayCard(card, useGame.getState().list.length > 0)
    }
  })
  ;(r.roomUpdates || []).forEach((u) => {
    if (useFriends.getState().chatRoom === u.roomId) applyChatMessage(u as ChatMessage)
  })
  ;(r.roomVoice || []).forEach((v) => rooms.setVoice(v.roomId, v.members))
  const f = useFriends.getState()
  if (f.chatRoom) {
    const mine = (r.roomTyping || []).find((t) => t.roomId === f.chatRoom)
    polledRoomTypers = { roomId: f.chatRoom, users: mine?.users || [], at: Date.now() }
    showRoomTypers(f.chatRoom)
  }
}

let polledRoomTypers: { roomId: string; users: string[]; at: number } = { roomId: '', users: [], at: 0 }
const pushedRoomTypers = new Map<string, Map<string, number>>()

function showRoomTypers(roomId: string) {
  const f = useFriends.getState()
  if (f.chatRoom !== roomId) return
  const now = Date.now()
  // A poll snapshot only vouches for a typer as long as the server's typing flag lives.
  const fresh = polledRoomTypers.roomId === roomId && now - polledRoomTypers.at < TYPING_FALLBACK_MS
  const users = mergeTypers(fresh ? polledRoomTypers.users : [], pushedRoomTypers.get(roomId) || new Map<string, number>(), now)
  f.set({ chatTypers: users.map((id) => nickInRooms(id) || t('Кто-то')) })
}

function applyRoomTypingPush(p: RoomTypingPush) {
  const now = Date.now()
  const hold = typingHoldMs(p.until, now)
  const room = pushedRoomTypers.get(p.roomId) || new Map<string, number>()
  for (const [id, until] of room) if (until <= now) room.delete(id)
  room.set(p.from, now + hold)
  pushedRoomTypers.set(p.roomId, room)
  showRoomTypers(p.roomId)
  setTimeout(() => showRoomTypers(p.roomId), hold + 50)
}

function previewOf(m: PolledMessage): string {
  const text = String(m.text || '')
  if (m.attachment?.kind === 'voice') return t('Голосовое сообщение')
  if (m.attachment?.kind === 'image') return t('Картинка')
  const call = parseCallLog(text)
  if (call) return call.outcome === 'done' ? t('Звонок завершён') : t('Пропущенный звонок')
  const mark = parseMark(text)
  if (mark) return markPreview(mark)
  return parseInvite(text) ? t('Приглашение на сервер') : text
}
import { refreshPlayStats, rememberServerName, serverNameFor, watchPlaytimeWhileRunning } from './state/playStats'
import { claimJoin, watchJoinClaims } from './lib/joinClaim'
import { quickJoin } from './lib/joinServer'
import { findProfile, refreshProfiles } from './state/profiles'
import { gameCrashData } from './lib/crashEvent'
import { initMusic, startMusicAfterLogin, stopMusicNow } from './state/music'
import { initSounds, playSound } from './lib/sound'
import { initUiTracking } from './lib/uiTrack'
import { initWindowResume, windowReopened } from './lib/windowResume'
import { initCli } from './lib/cli'
import { initSessionKick } from './lib/sessionKick'
import { McNewsModal } from './components/McNews'
import { initA11y } from './lib/a11y'
import { initGameInvites } from './lib/gameInvite'
import { initOverlayLink } from './lib/overlayLink'
import { initStreakReminder } from './lib/streakReminder'
import { initAutostart } from './lib/autostart'
import { initStreakActivity } from './lib/streakActivity'
import { useMods } from './state/mods'
import { refreshMsAccounts } from './state/msLogin'
import { enterApp, logoutToLogin } from './lib/session'
import { initSecrets } from './lib/secure'
import { listenGameCrash, listenGameExit, listenGameServer, listenLaunchWarning, listenPackAccessLost, listenTrayExit } from './ipc/events'
import { useCrash } from './state/crash'
import { fixMark, forgetCrash, rememberCrash } from './lib/repair'
import { tryAutoHeal } from './lib/autoHeal'
import { exitToastWithFps } from './lib/gfxFpsToast'
import { sendCompatSignal } from './lib/compatSignal'
import { syncRunningGame, useGame } from './state/game'
import { watchPromo } from './state/promo'
import { watchArcania2 } from './lib/arcaniaRelease'
import { warmArcaniaCover } from './components/arcania/ArcaniaCard'
import { watchPromoServers } from './lib/promoServers'
import { LagCard } from './components/LagCard'
import { startLiveLog } from './components/liveLogStore'
import { startLagHelp } from './lib/lagHelp'
import { hideBoot } from './lib/boot'
import { frontendReady } from './ipc/commands'
import { initTelemetry, track, trackAppExit } from './lib/telemetry'
import { screenPainted } from './lib/screenOpen'
import { reportWebviewFailure, setLauncherIdleMemory, watchHeap, watchWebviewContext } from './lib/webviewHealth'
import { onRenderGate, renderLive } from './lib/renderGate'
import { currentDeviceTier } from './lib/deviceTier'
import { liteOn } from './lib/liteMode'
import { flushPrefs, hydratePrefs } from './lib/prefs'

/// The window may be unloaded and rebuilt while the game runs (lib/window.ts): the
/// start time has to outlive the page for the exit's duration and «calm» check.
const GAME_START_KEY = 'm-game-started-at'
const readGameStart = (): number => {
  try {
    const v = Number(localStorage.getItem(GAME_START_KEY) || 0)
    return v > 0 && Date.now() - v < 86_400_000 ? v : 0
  } catch {
    return 0
  }
}
const storeGameStart = (at: number) => {
  try {
    if (at) localStorage.setItem(GAME_START_KEY, String(at))
    else localStorage.removeItem(GAME_START_KEY)
  } catch {}
}
let gameStartedAt = readGameStart()
/** Когда запускали в последний раз. Не обнуляется выходом: событие выхода приходит и раньше события вылета. */
let lastGameStartAt = gameStartedAt
import { flushNativeCrashes, installErrorHandlers, reportGameCrash } from './lib/crash'
import { bootUpdate, checkForUpdate, installUpdateOnExit, pollUpdate, setUpdateBusyProbe, updateReady } from './lib/updater'
import { pickReplies, replyText } from './lib/bugReplies'
import { BootUpdate } from './components/BootUpdate'
import { Welcome } from './components/Welcome'
import { useSlidingSegs } from './lib/slidingSegs'
import { beatAfterReconnect, gameSession, heartbeat, launchInProgress, ramMbFor, reconcileGameSession, setGameSession, updateSessionServer } from './lib/launch'
import { POLL_BASE_MS, pollIntervalFrom } from './lib/pollPace'
import { friendsPollDelayMs, friendsPollWait, pokeGate, safetyRefresh } from './lib/realtimePace'
import {
  isPresenceTracked,
  isRealtimeLive,
  onRealtime,
  onRealtimeData,
  onRealtimeLiveChange,
  onPresenceModeChange,
  onRealtimeSettled,
  retainRealtime,
} from './lib/realtime'
import { initRealtimeRelay } from './lib/realtimeRelay'
import {
  TYPING_FALLBACK_MS,
  mergeTypers,
  readPresencePush,
  readRoomTypingPush,
  readTypingPush,
  typingHoldMs,
  withPresence,
  type RoomTypingPush,
} from './lib/friendsPush'
import { hideLauncherToTray, initTray, restoreLauncher, restoreOnGameExit, trayCloseEnabled } from './lib/window'
import { SESSION_EXPIRED_EVENT, api, hasMillidaAccount } from './lib/api'
import { hasTauri, tauri } from './ipc/tauri'
import type { UnlistenFn } from './ipc/tauri'
import { syncLocaleFromPrefs, t, useT } from './i18n'

function joinAction(f: Friend): (() => void) | undefined {
  const addr = f.serverIp || ''
  if (!addr) return undefined
  const name = f.serverName || (f.nickname ? t('Сервер {nick}', { nick: f.nickname }) : t('Сервер друга'))
  return () => {
    rememberServerName(addr, name)
    void quickJoin(addr, name).catch(() => {})
  }
}

/// One card per batch, Steam-style: a poll tick that brings five friends online
/// used to stack five toasts and five sounds.
function announcePresence(list: Friend[], kind: 'play' | 'online') {
  if (!list.length || !notifyShown(kind)) return
  const head = list[0]
  const card = {
    uid: kind + ':' + head.userId,
    nick: presenceTitle(list),
    text: presenceText(list, kind),
    ts: Date.now(),
    kind,
    nicks: list.map((f) => f.nickname || t('Друг')),
    open: 'friends' as const,
  }
  if (showDesktopToast(card)) {
    if (notifyAudible(kind)) playSound('notify')
    return
  }
  const join = list.length === 1 && kind === 'play' ? joinAction(head) : undefined
  pushChatNotify({
    uid: card.uid,
    nick: card.nick,
    text: card.text,
    kind,
    actionLabel: join ? t('Зайти к нему') : t('Открыть друзей'),
    action: join || (() => gotoScreen('friends')),
  })
}

const presenceMemo = createPresenceMemo()

function notifyPresence(before: Friend[], now: Friend[]) {
  const { started, cameOnline } = presenceEvents(before, now, presenceMemo)
  announcePresence(started, 'play')
  announcePresence(cameOnline, 'online')
}

/** Пока грузится кусок экрана — серые строки, а не пустое окно под шапкой. */
/// Sits inside the screens' Suspense boundary, so it mounts only once the new screen's code has
/// loaded and its content is committed; the next frame after that is "the screen is open".
function ScreenOpenProbe({ screen }: { screen: ScreenId }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setTimeout(() => {
        const opened = screenPainted(screen)
        if (opened) track('perf', { what: 'screen_open', screen: opened.screen, from: opened.from, ms: opened.ms, visit: opened.visit })
      }, 0),
    )
    return () => cancelAnimationFrame(frame)
  }, [screen])
  return null
}

function ScreenSkeleton() {
  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: 12, padding: '24px 28px' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="skel skel-line" style={{ width: 280 + ((i * 61) % 240) + 'px', maxWidth: '100%', height: 18 }} />
      ))}
    </div>
  )
}

export function App() {
  // Subscribes the shell to language changes; long-lived effects below read the global t, not a captured one.
  useT()
  useSlidingSegs()
  const classic = useLayout((st) => st.layout === 'classic')
  // Subscribe field by field: subscribing to the whole store re-rendered the active
  // screen on every toast, animation frame and install progress event.
  const logged = useUi((s) => s.logged)
  const screen = useUi((s) => s.screen)
  const navPending = useUi((s) => s.navPending)
  const setScreen = useUi((s) => s.setScreen)
  const instanceMounted = useUi((s) => s.modals.bsModal.open || s.modals.bsModal.vis)
  const projectMounted = useEverTrue(useUi((s) => s.modals.pjModal.open || s.modals.pjModal.vis))
  const newBuildMounted = useEverTrue(useUi((s) => s.modals.nbModal.open || s.modals.nbModal.vis))
  const onboardingMounted = useEverTrue(useOnboarding((s) => s.open))

  useEffect(() => {
    // Until this lands, the native watchdog treats the window as blank and
    // reinstalls the launcher.
    void frontendReady()
    installErrorHandlers()
    initChatScreen()
    void initAccent()
    void initDensity()
    initTray()
    initMusic()
    initSounds()
    initUiTracking(
      () => useUi.getState().screen,
      (cb) => useUi.subscribe((st, prev) => cb(st.screen, prev.screen)),
    )
    watchWebviewContext(
      () => useUi.getState().screen,
      (cb) => useUi.subscribe((st, prev) => void (st.screen !== prev.screen && cb(st.screen))),
    )
    void initDesktopToasts()
    void initAutostart()
    initWindowResume()
    initCli()
    initSessionKick()
    initA11y()
    initGameInvites()
    initOverlayLink()
    initInstalls()
    syncNativeTexts()
    // Сборки обновляются только при «Играть» (владелец 08.10.2026: фоновая докачка мешала) — initPackAutoUpdate не запускаем.
    const releaseRealtime = retainRealtime()
    const stopRelay = initRealtimeRelay()
    initCalls()
    const stopPromo = watchPromo()
    const stopArcania2 = watchArcania2(warmArcaniaCover)
    const stopStreakReminder = initStreakReminder()
    const stopStreakActivity = initStreakActivity()
    const stopPromoServers = watchPromoServers()
    // The update never holds the start: screens warm up at once, the check runs next to them,
    // and only a release the manifest calls critical takes the window over (updater.ts).
    setUpdateBusyProbe(() => launchInProgress() || Object.values(useInstalls.getState().tasks).some((x) => x.state === 'run'))
    // По одному, в простое и после первого движения мыши; на слабом ПК — только два самых вероятных.
    preloadScreens(
      () => useUi.getState().screen,
      () => currentDeviceTier() === 'low' || liteOn(),
    )
    void bootUpdate()
    const updPoll = setInterval(pollUpdate, 1_800_000)
    // The launcher can sit in the tray longer than an MC token lives, so refresh
    // near-expiry accounts periodically.
    const msPoll = setInterval(() => {
      void refreshMsAccounts()
    }, 1_800_000)
    const onVisible = () => {
      if (document.hidden) {
        void flushPrefs()
        setLauncherIdleMemory(true)
        return
      }
      setLauncherIdleMemory(false)
      void loadFriends()
      heartbeat()
    }
    document.addEventListener('visibilitychange', onVisible)
    // В трее и под игрой окно для WebView2 остаётся видимым, visibilitychange не
    // приходит: кэши вебвью отдаются игре и тогда, но не на каждый alt-tab.
    let idleMemory = 0
    const offIdleMemory = onRenderGate(() => {
      window.clearTimeout(idleMemory)
      if (renderLive()) {
        if (!document.hidden) setLauncherIdleMemory(false)
        return
      }
      idleMemory = window.setTimeout(() => {
        if (!renderLive()) setLauncherIdleMemory(true)
      }, 30_000)
    })
    const onLeave = () => void flushPrefs()
    window.addEventListener('pagehide', onLeave)
    const safety = setTimeout(hideBoot, 4000)
    // The "logged in at least once" flag lives in the durable prefs file, so the
    // disk copy has to land before boot decides whether this account may skip login.
    void Promise.all([initSecrets(), hydratePrefs()]).then(() => {
      clearTimeout(safety)
      syncLocaleFromPrefs()
      const acc = getAccount()
      const millida = getMillidaAccount()
      if (millida) markMillidaEver()
      // No way in without a Millida account (owner 27.10.2026: no guest mode, sign-in only).
      // The browser preview (dev only) has neither the core nor a sign-in.
      const preview = import.meta.env.DEV && !hasTauri()
      // Account present but its token did not survive a secret-storage migration:
      // clear the session once instead of showing a half-logged-in state everywhere.
      if (millida && !hasMillidaAccount() && !preview) {
        logoutToLogin()
        showToast(t('После обновления войдите в Millida заново — один раз'), 'error')
      } else if (!millida && !preview) {
        logoutToLogin()
        if (acc) showToast(t('Войди в аккаунт Millida — это нужно один раз'), 'error')
      } else if (acc && gameStepPending() && !hasGameAccount()) {
        useUi.getState().setLogged(false)
        useFirstRun.setState({ open: true })
      } else if (acc) enterApp()
      else logoutToLogin()
      void refreshProfiles()
      loadLiveRating()
      warmHeads(useAccounts.getState().list.filter((x) => !x.avatar).map((x) => x.nick))
      // Каталог — своим куском сборки, не в стартовом: тянем его после загрузки.
      void import('./components/catalog/siteStore').then((m) => m.warmCatalog()).catch(() => {})
      void loadFriends()
      void refreshGameNick()
      void refreshMsAccounts()
      void flushNativeCrashes()
      hideBoot()
      void windowReopened()
        .then((again) => initTelemetry(performance.now(), again))
        .then(reportWebviewFailure)
      watchHeap()
    })
    return () => {
            stopRelay()
      stopPromo()
      stopArcania2()
      stopStreakReminder()
      stopStreakActivity()
      stopPromoServers()
      releaseRealtime()
      clearInterval(updPoll)
      clearInterval(msPoll)
      document.removeEventListener('visibilitychange', onVisible)
      offIdleMemory()
      window.clearTimeout(idleMemory)
      window.removeEventListener('pagehide', onLeave)
    }
  }, [])

  useEffect(() => {
    const T = tauri()
    const w = hasTauri() && T && T.window ? T.window.getCurrentWindow() : null
    if (!w || !w.onCloseRequested) return
    let unlisten: UnlistenFn | null = null
    let leaving = false
    void w
      .onCloseRequested(async (e) => {
        if (leaving) return
        // The cross goes to the tray even with an update waiting: the update lands on «Выход»
        // from the tray or on the next start, never by closing the window someone meant to keep.
        if (trayCloseEnabled()) {
          e.preventDefault()
          hideLauncherToTray()
          return
        }
        if (updateReady()) {
          leaving = true
          e.preventDefault()
          await installUpdateOnExit()
        }
      })
      .then((u) => {
        unlisten = u
      })
      .catch(() => {})
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  // The core allows ~1.5s here before it exits on its own.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    void listenTrayExit(() => {
      trackAppExit()
      stopMusicNow()
      void flushPrefs()
      if (updateReady()) void installUpdateOnExit()
    }).then((u) => {
      unlisten = u
    })
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    const onExpired = () => {
      // Чистим состояние и при logged=false: фоновые опросы (присутствие,
      // телеметрия, синк) идут и до входа в оболочку, и без очистки аккаунт
      // остаётся наполовину залогиненным до перезапуска.
      const wasLogged = useUi.getState().logged
      logoutToLogin()
      if (wasLogged) showToast(t('Сессия истекла — войди заново'), 'error')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    void listenLaunchWarning((msg) => showToast(msg, 'error')).then((u) => {
      unlisten = u
    })
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    const screen = safetyRefresh({
      load: () => Promise.all([loadFriends(), loadRooms()]),
      allowed: () => !document.hidden && useUi.getState().screen === 'friends',
      live: isRealtimeLive,
      hidden: () => document.hidden,
    })
    const t = setInterval(screen.tick, 30000)
    const offFriends = onRealtime('friends', screen.poke)
    const offPresence = onRealtime('presence', screen.poke)
    return () => {
      clearInterval(t)
      offFriends()
      offPresence()
    }
  }, [])

  useEffect(() => {
    // The backend keeps a friend online for 60s after the last beat, so beating
    // faster than 45s is pointless; hidden windows only slow down, never stop.
    let lastBeat = 0
    const beat = setInterval(() => {
      const quiet = document.hidden && !gameSession()
      if (Date.now() - lastBeat < (quiet ? 55000 : 45000)) return
      lastBeat = Date.now()
      void reconcileGameSession().then(() => heartbeat('lobby'))
    }, 15000)
    const t0 = setTimeout(() => heartbeat('lobby'), 1500)
    const offSettled = onRealtimeSettled(() => {
      if (isPresenceTracked()) beatAfterReconnect()
    })
    // A rollback or a grant without socket presence hands the beat back to HTTP right away.
    const offPresenceMode = onPresenceModeChange((tracked) => {
      if (tracked) {
        beatAfterReconnect()
        return
      }
      lastBeat = Date.now()
      void reconcileGameSession().then(() => heartbeat('lobby'))
    })
    // Once the socket is gone the server keeps the player online only until the last
    // presence mark is a minute old, so the HTTP beat has to take over well before that.
    let dropTimer: ReturnType<typeof setTimeout> | undefined
    const offLive = onRealtimeLiveChange((live) => {
      clearTimeout(dropTimer)
      if (live) return
      dropTimer = setTimeout(() => {
        if (isPresenceTracked()) return
        lastBeat = Date.now()
        void reconcileGameSession().then(() => heartbeat('lobby'))
      }, 10_000)
    })
    syncRunningGame()
    let unlisten: (() => void) | null = null
    const onGameStarted = () => {
      gameStartedAt = Date.now()
      lastGameStartAt = gameStartedAt
      storeGameStart(gameStartedAt)
    }
    window.addEventListener('millida-game-started', onGameStarted)

    // Пока идёт игра, счёт часов перечитывается сам: ядро пишет его раз в
    // минуту, а до сих пор интерфейс спрашивал только при выходе, и под
    // запущенной сборкой время не появлялось вовсе.
    watchPlaytimeWhileRunning(() => useGame.getState().list.length > 0)
    startLagHelp()
    startLiveLog()
    const stopJoinClaims = watchJoinClaims()
    void listenGameExit((profile) => {
      // Отыграл спокойно 3+ минуты — план вылета, случившегося до этого запуска, больше не нужен,
      // а починка перед ним засчитывается.
      const calm = !!gameStartedAt && Date.now() - gameStartedAt > 180_000
      const fixed = fixMark(profile, calm)
      track('game_exit', fixed ? { fix: fixed } : {}, { durationMs: gameStartedAt ? Date.now() - gameStartedAt : undefined })
      if (calm) {
        forgetCrash(profile, gameStartedAt)
        void sendCompatSignal(profile, null)
      }
      useGame.getState().removeRunning(profile)
      // A second copy may still be alive — only the last exit puts the launcher back into lobby.
      if (useGame.getState().list.length) {
        void refreshPlayStats()
        showToast(t('Игра «{name}» закрыта', { name: profile }))
        return
      }
      gameStartedAt = 0
      storeGameStart(0)
      setGameSession(null)
      heartbeat('lobby')
      void refreshPlayStats()
      if (restoreOnGameExit()) restoreLauncher()
      void exitToastWithFps(profile)
    }).then((u) => {
      unlisten = u
    })
    let unServer: UnlistenFn | null = null
    void listenGameServer((addr) => {
      if (addr) void claimJoin(addr)
      const name = addr ? serverNameFor(addr) : ''
      if (addr && name) rememberServerName(addr, name)
      updateSessionServer(addr || null, name || null)
      void refreshPlayStats()
    }).then((u) => {
      unServer = u
    })
    let unCrash: UnlistenFn | null = null
    void listenGameCrash((info) => {
      // Слаг сборки в событии — чтобы «здоровье сборки» знало, чья это
      // ошибка, а не угадывало по последнему запуску на устройстве; mc и
      // загрузчик — чтобы не склеивать их с запусками задним числом.
      const crashed = info && info.profile ? info.profile : ''
      const prof = crashed ? findProfile(crashed) : null
      void (crashed ? loadProfileSettings(crashed).catch(() => null) : Promise.resolve(null)).then((s) => {
        const fixed = crashed ? fixMark(crashed, true) : undefined
        track('game_crash', { ...gameCrashData(info, prof, s, crashed ? [[crashed, '<build>'], [effectiveNick(), '<nick>']] : []), ...(fixed ? { fix: fixed } : {}) }, {
          ok: false,
        })
      })
      // Отказ загрузчика на старте с точным планом чиним сами и запускаем снова; окно — для остального.
      if (!tryAutoHeal(info, lastGameStartAt)) useCrash.getState().show(info)
      if (info && info.profile) {
        rememberCrash(info)
        void sendCompatSignal(info.profile, info)
      }
      if (info && info.profile) {
        void reportGameCrash(info, {
          profile: findProfile(info.profile),
          ramRequestedMb: ramMbFor(info.profile),
          nick: effectiveNick(),
        })
      }
    }).then((u) => {
      unCrash = u
    })
    let unPackAccess: UnlistenFn | null = null
    void listenPackAccessLost((info) => {
      showToast(info.message, 'error')
      if (info.removed) void refreshProfiles()
    }).then((u) => {
      unPackAccess = u
    })
    return () => {
      window.removeEventListener('millida-game-started', onGameStarted)
      clearInterval(beat)
      clearTimeout(t0)
      clearTimeout(dropTimer)
      offSettled()
      offPresenceMode()
      offLive()
      if (unlisten) unlisten()
      stopJoinClaims()
      if (unServer) unServer()
      if (unCrash) unCrash()
      if (unPackAccess) unPackAccess()
    }
  }, [])

  useEffect(() => {
    let stopped = false
    // The cursor survives a restart, so messages that arrived while the
    // launcher was closed still show up as unread instead of silently landing
    // in history.
    const CURSOR = 'm-poll-since'
    let since = Number(localStorage.getItem(CURSOR)) || Date.now()
    let firstPass = true
    let timer: ReturnType<typeof setTimeout>
    // Частоту задаёт сервер: установленный лаунчер живёт у игрока днями, и
    // жёсткое значение в клиенте нельзя пересмотреть без выпуска версии.
    let serverPollMs = POLL_BASE_MS
    let failures = 0
    let waited = false
    // Refocusing the window wakes the loop early; a second loop next to one still
    // waiting on the long poll would fetch the same messages and notify twice.
    let inFlight = false
    const seenMessages = new Set<string>()
    const loop = async () => {
      if (stopped || inFlight) return
      inFlight = true
      if (hasMillidaAccount()) {
        try {
          const r = await api('/friends/poll?wait=' + friendsPollWait(isRealtimeLive()) + '&since=' + since)
          serverPollMs = pollIntervalFrom(r.nextPollMs)
          waited = r.waited === true
          failures = 0
          since = r.now || Date.now()
          localStorage.setItem(CURSOR, String(since))
          if (r.presence) {
            const before = useFriends.getState().friends
            useFriends.getState().set({ friends: r.presence })
            if (!firstPass) notifyPresence(before, r.presence)
          }
          if (r.requests) {
            const seen = new Set(useFriends.getState().reqIn.map((x) => x.id))
            const incoming: FriendRequest[] = r.requests.incoming || []
            useFriends.getState().set({ reqIn: incoming, reqOut: r.requests.outgoing || [] })
            if (!firstPass)
              incoming
                .filter((x) => !seen.has(x.id))
                .forEach((x) =>
                  pushChatNotify({
                    uid: x.userId || x.id,
                    nick: x.nickname || t('Игрок'),
                    text: t('Хочет добавить тебя в друзья'),
                    kind: 'request',
                    actionLabel: t('Открыть заявки'),
                    action: () => setScreen('friends'),
                  }),
                )
          }
          ;(r.messages || []).forEach((m: PolledMessage) => {
            if (m.id && seenMessages.has(m.id)) return
            if (m.id) seenMessages.add(m.id)
            if (seenMessages.size > 500) seenMessages.delete(seenMessages.values().next().value as string)
            const f = useFriends.getState()
            if (f.chatOpen && f.chatWith === m.from) {
              appendChatMessage({
                id: m.id,
                text: String(m.text || ''),
                ts: m.ts,
                attachment: m.attachment || null,
                replyTo: m.replyTo || null,
                reactions: m.reactions || [],
              })
              if (notifyAudible('msg')) playSound('notify')
              void api('/friends/chat/' + encodeURIComponent(m.from) + '/read', { method: 'POST' }).catch(() => {})
            } else {
              const nick = m.fromNick || f.friends.find((x) => x.userId === m.from)?.nickname || ''
              pushChatNotify({ uid: m.from, nick, text: previewOf(m) })
              // While the game holds the screen, the launcher's own toast is
              // invisible — the card has to go over the game instead.
              if (notifyShown('msg')) {
                const card = {
                  uid: m.from,
                  nick,
                  text: previewOf(m),
                  ts: m.ts || Date.now(),
                  kind: 'msg' as const,
                  open: 'chat' as const,
                }
                showAwayCard(card, useGame.getState().list.length > 0)
              }
            }
          })
          ;(r.updates || []).forEach((u: PolledUpdate) => {
            if (useFriends.getState().chatWith === u.peer) applyChatMessage(u)
          })
          applyRoomPoll(r)
          const chat = useFriends.getState()
          if (chat.chatWith) {
            const mine = (r.reads || []).find((x: PolledRead) => x.userId === chat.chatWith)
            if (mine) chat.set({ chatPeerReadAt: mine.readAt })
            chat.set({ chatTyping: (r.typing || []).includes(chat.chatWith) })
          }
          firstPass = false
        } catch {
          failures += 1
          waited = false
        }
      }
      inFlight = false
      timer = setTimeout(loop, friendsPollDelayMs(isRealtimeLive(), serverPollMs, failures, document.hidden, Math.random, waited))
      if (gate.take()) fire()
    }
    const fire = () => {
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(loop, 0)
    }
    const gate = pokeGate(() => inFlight, fire)
    const offPoke = onRealtime('friends', gate.poke)
    const offPresencePoke = onRealtime('presence', gate.poke)
    const offPresenceData = onRealtimeData('presence', (data) => {
      const u = readPresencePush(data)
      if (!u) return
      const before = useFriends.getState().friends
      const next = withPresence(before, u)
      if (!next) {
        gate.poke()
        return
      }
      useFriends.getState().set({ friends: next })
      notifyPresence(before, next)
    })
    const offTyping = onRealtimeData('friends', (data) => {
      const typing = readTypingPush(data)
      if (typing) applyTypingPush(typing)
    })
    const offRoomTyping = onRealtimeData('rooms', (data) => {
      const typing = readRoomTypingPush(data)
      if (typing) applyRoomTypingPush(typing)
    })
    const offLive = onRealtimeLiveChange((live) => {
      if (!live) gate.poke()
    })
    const wake = () => {
      if (document.hidden || inFlight || isRealtimeLive()) return
      clearTimeout(timer)
      timer = setTimeout(loop, 200)
    }
    document.addEventListener('visibilitychange', wake)
    timer = setTimeout(loop, 3000)
    return () => {
      stopped = true
      clearTimeout(timer)
      offPoke()
      offPresencePoke()
      offPresenceData()
      offTyping()
      offRoomTyping()
      offLive()
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  useEffect(() => {
    if (logged) startMusicAfterLogin()
  }, [logged])

  // "Fixed in version X" for the player's own bug reports: asked once per start, a while after login so it does not compete with the boot.
  useEffect(() => {
    if (!logged) return
    let off = false
    const timer = setTimeout(() => {
      if (!hasMillidaAccount()) return
      void api('/bug-reports/me/replies')
        .then((r) => {
          const items = off ? [] : pickReplies(r?.items)
          items.forEach((it, i) =>
            setTimeout(() => {
              showToast(replyText({ kind: 'fixed', workaround: null, version: it.version }, t), 'ok', undefined, {
                label: t('Обновиться'),
                run: () => void checkForUpdate(true),
              })
            }, i * 8000),
          )
          if (items.length) {
            void api('/bug-reports/me/replies/seen', { method: 'POST', body: JSON.stringify({ ids: items.map((x) => x.id) }) }).catch(() => {})
          }
        })
        .catch(() => {})
    }, 20_000)
    return () => {
      off = true
      clearTimeout(timer)
    }
  }, [logged])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const id = modalToClose(openLayers())
      if (id) closeModal(id)
      useWallpaper.getState().setPopOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <SvgSprite />
      <BootUpdate />
      <Welcome />
      <div className="window" id="win">
        <Titlebar />
        <UpdateBanner />

        <Login on={!logged} />

        <div className="app" id="scr-app" style={{ display: logged ? 'flex' : 'none' }}>
          {(() => {
            const onNav = (s: ScreenId) => {
              if (s === 'hosting') track('hosting_open', {})
              if (s === 'servers') track('rating_open', {})
              if (s === 'mods') useMods.getState().scopeTo(null)
              setScreen(s)
              const c = document.querySelector('.content')
              if (c) c.scrollTop = 0
            }
            return classic ? (
              <Suspense fallback={null}>
                <ClassicSidebar onNav={onNav} />
              </Suspense>
            ) : (
              <Sidebar onNav={onNav} />
            )
          })()}
          <main className={'content' + (navPending ? ' nav-pending' : '')}>
            {/* Классика: шапки с вкладками нет — переключатель «Мои сборки / Каталог» над экраном. */}
            {classic && screen === 'playhub' ? (
              <div className="cl-hubbar">
                <HubTopTabs libLabel={t('Мои сборки')} />
                <span className="cl-hubbar-act">
                  <PlayhubBar />
                </span>
              </div>
            ) : null}
            {/* Navigation runs in a transition, so the fallback only ever shows on
                the very first render. */}
            <Suspense fallback={<ScreenSkeleton />}>
              <ScreenOpenProbe screen={screen} />
              {screen === 'play' && (
                <Guard what="Лобби">
                  {classic ? <ClassicHome on /> : <Play on />}
                </Guard>
              )}
              {screen === 'premium' && (
                <Guard what="PLUS">
                  <Premium on />
                </Guard>
              )}
              {screen === 'plus' && (
                <Guard what="PLUS">
                  <Plus on />
                </Guard>
              )}
              {screen === 'builds' && (
                <Guard what="Сборки">
                  <Builds on />
                </Guard>
              )}
              {screen === 'servers' && (
                <Guard what="Серверы">
                  <Servers on />
                </Guard>
              )}
              {screen === 'mods' && (
                <Guard what="Каталог">
                  <Mods on />
                </Guard>
              )}
              {screen === 'skins' && (
                <Guard what="Экран скинов">
                  <Skins on />
                </Guard>
              )}
              {screen === 'rubies' && (
                <Guard what="Магазин">
                  <Rubies on />
                </Guard>
              )}
              {screen === 'friends' && (
                <Guard what="Друзья">
                  <Friends on />
                </Guard>
              )}
              {screen === 'top' && (
                <Guard what="Топ">
                  <Top on />
                </Guard>
              )}
              {screen === 'chat' && (
                <Guard what="Сообщения">
                  <Messages on />
                </Guard>
              )}
              {screen === 'hosting' && (
                <Guard what="Хостинг">
                  <Hosting on />
                </Guard>
              )}
              {screen === 'playhub' && (
                <Guard what="Библиотека">
                  <PlayHub on />
                </Guard>
              )}
              {screen === 'pvp' && (
                <Guard what="PvP">
                  <Pvp on />
                </Guard>
              )}
              {screen === 'settings' && (
                <Guard what="Настройки">
                  <Settings on />
                </Guard>
              )}
            </Suspense>
          </main>
        </div>

        {instanceMounted && (
          <Suspense fallback={null}>
            <InstancePage />
          </Suspense>
        )}
        <MilliDock />
        <ImportModal />
        <MoveBuildsModal />
        {projectMounted && (
          <Suspense fallback={null}>
            <ProjectModal />
          </Suspense>
        )}
        {newBuildMounted && (
          <Suspense fallback={null}>
            <NewBuildModal />
          </Suspense>
        )}
        <AccountAddModal />
        <BuyModal />
        <ScreenshotsOverlay />
        <ModpackVersionsOverlay />
        <MigrateBuildModal />
        <BuildPicker />
        <PackKeyHost />
        <DepPlanModal />
        <PackCodeHost />
        <PartyHost />
        <CrashModal />
        <LagCard />
        <LiveLog />
        <ServerDetail />
        <ChatNotify />
        <CallPanel />
        <RoomModals />
        {/* Mounted last: it asks on top of any other modal, and DOM order breaks
            ties between equal z-index values. */}
        <McNewsModal />
        <CommandPalette />
        <ConfirmModal />
        <ImageLightbox />
        {onboardingMounted && (
          <Suspense fallback={null}>
            <OnboardingModal />
          </Suspense>
        )}
        <Tour />
        <Installs />
        <PackDrop />
        <LaunchToast />
        <Toast />
        <RewardHost />
        <Suspense fallback={null}>
          <ChestOpenHost />
        </Suspense>
        <PixelTip />
      </div>
    </>
  )
}
