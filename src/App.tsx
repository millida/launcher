import { Suspense, lazy, useEffect } from 'react'
import { SvgSprite } from './components/SvgSprite'
import { Titlebar } from './components/Titlebar'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import { Chat } from './components/Chat'
import { Login } from './screens/Login'
// Screens are mounted only while open, and their chunks are prewarmed after boot
// so switching tabs stays instant.
import { Builds, Friends, Hosting, Mods, Play, Servers, Settings, Skins, preloadScreens } from './screens/registry'
const InstancePage = lazy(() => import('./modals/InstancePage').then((m) => ({ default: m.InstancePage })))
import { ImportModal } from './modals/Import'
import { ProjectModal } from './modals/Project'
import { NewBuildModal } from './modals/NewBuild'
import { AccountAddModal } from './modals/AccountAdd'
import { ModpackVersionsOverlay, ScreenshotsOverlay } from './modals/Overlays'
import { ImageLightbox } from './components/ImageLightbox'
import { UpdateBanner } from './components/UpdateBanner'
import { ConfirmModal } from './components/ConfirmModal'
import { BuildPicker } from './components/BuildPicker'
import { DepPlanModal } from './components/DepPlanModal'
import { ChatNotify } from './components/ChatNotify'
import { CallPanel } from './components/CallPanel'
import { RoomModals } from './components/RoomManage'
import { Installs } from './components/Installs'
import { initInstalls } from './state/installs'
import { initCalls } from './state/call'
import { overlayNotify } from './ipc/commands'
import { ServerDetail } from './components/ServerDetail'
import { pushChatNotify } from './state/chatNotify'
import { notifyAudible, notifyShown } from './state/notifyPrefs'
import { presenceEvents, presenceText, presenceTitle } from './state/presenceNotify'
import { initDesktopToasts, showDesktopToast } from './lib/desktopToast'
import { parseInvite } from './lib/invite'
import { parseCallLog } from './lib/call/callLog'
import { getAccount, getMillidaAccount, isMillidaKind, useAccounts } from './state/accounts'
import { markMillidaEver, millidaEver } from './state/onboarding'
import { OnboardingModal } from './modals/Onboarding'
import { Tour } from './components/Tour'
import { initAccent } from './lib/accent'
import { initTheme } from './lib/theme'
import { initThemePacks } from './lib/themes'
import { refreshGameNick } from './state/gameNick'
import { warmHeads } from './lib/heads'
import { useUi, closeModal, setScreen as gotoScreen, showToast } from './state/ui'
import { useWallpaper } from './state/wallpaper'
import { loadLiveRating } from './state/servers'
import { appendChatMessage, applyChatMessage, loadFriends, openRoomChat, useFriends } from './state/friends'
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
    const title = roomById(m.roomId)?.title || 'Группа'
    const nick = m.fromNick || ''
    pushChatNotify({
      uid: m.roomId,
      nick: title,
      text: (nick ? nick + ': ' : '') + previewOf(m),
      kind: 'room',
      actionLabel: 'Открыть группу',
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
      if (!showDesktopToast(card) && useGame.getState().list.length) void overlayNotify(card).catch(() => {})
    }
  })
  ;(r.roomUpdates || []).forEach((u) => {
    if (useFriends.getState().chatRoom === u.roomId) applyChatMessage(u as ChatMessage)
  })
  ;(r.roomVoice || []).forEach((v) => rooms.setVoice(v.roomId, v.members))
  const f = useFriends.getState()
  if (f.chatRoom) {
    const mine = (r.roomTyping || []).find((t) => t.roomId === f.chatRoom)
    f.set({ chatTypers: (mine?.users || []).map((id) => nickInRooms(id) || 'Кто-то') })
  }
}

function previewOf(m: PolledMessage): string {
  const text = String(m.text || '')
  if (m.attachment?.kind === 'voice') return 'Голосовое сообщение'
  if (m.attachment?.kind === 'image') return 'Картинка'
  const call = parseCallLog(text)
  if (call) return call.outcome === 'done' ? 'Звонок завершён' : 'Пропущенный звонок'
  return parseInvite(text) ? 'Приглашение на сервер' : text
}
import { refreshPlayStats, rememberServerName, serverNameFor } from './state/playStats'
import { quickJoin } from './lib/joinServer'
import { refreshProfiles } from './state/profiles'
import { initMusic, startMusicAfterLogin, stopMusicNow } from './state/music'
import { initSounds, playSound } from './lib/sound'
import { initDeepLinks } from './lib/deeplink'
import { initOverlayLink } from './lib/overlayLink'
import { useMods } from './state/mods'
import { refreshMsAccounts } from './state/msLogin'
import { enterApp, logoutToLogin } from './lib/session'
import { initSecrets } from './lib/secure'
import { listenGameCrash, listenGameExit, listenGameServer, listenLaunchWarning, listenTrayExit } from './ipc/events'
import { useCrash } from './state/crash'
import { syncRunningGame, useGame } from './state/game'
import { CrashModal } from './components/CrashModal'
import { hideBoot } from './lib/boot'
import { frontendReady } from './ipc/commands'
import { initTelemetry, track } from './lib/telemetry'
import { flushPrefs, hydratePrefs } from './lib/prefs'

let gameStartedAt = 0
import { flushNativeCrashes, installErrorHandlers } from './lib/crash'
import { autoUpdate, bootUpdate, installUpdateOnExit, updateReady } from './lib/updater'
import { BootUpdate } from './components/BootUpdate'
import { gameSession, heartbeat, reconcileGameSession, setGameSession, updateSessionServer } from './lib/launch'
import { hideLauncherToTray, initTray, restoreLauncher, restoreOnGameExit, trayCloseEnabled } from './lib/window'
import { SESSION_EXPIRED_EVENT, api, hasMillidaAccount } from './lib/api'
import { hasTauri, tauri } from './ipc/tauri'
import type { UnlistenFn } from './ipc/tauri'

function joinAction(f: Friend): (() => void) | undefined {
  const addr = f.serverIp || ''
  if (!addr) return undefined
  const name = f.serverName || 'Сервер ' + (f.nickname || 'друга')
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
    nicks: list.map((f) => f.nickname || 'Друг'),
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
    actionLabel: join ? 'Зайти к нему' : 'Открыть друзей',
    action: join || (() => gotoScreen('friends')),
  })
}

function notifyPresence(before: Friend[], now: Friend[]) {
  const { started, cameOnline } = presenceEvents(before, now)
  announcePresence(started, 'play')
  announcePresence(cameOnline, 'online')
}

export function App() {
  // Subscribe field by field: subscribing to the whole store re-rendered the active
  // screen on every toast, animation frame and install progress event.
  const logged = useUi((s) => s.logged)
  const screen = useUi((s) => s.screen)
  const setScreen = useUi((s) => s.setScreen)
  const instanceMounted = useUi((s) => s.modals.bsModal.open || s.modals.bsModal.vis)

  useEffect(() => {
    // Until this lands, the native watchdog treats the window as blank and
    // reinstalls the launcher.
    void frontendReady()
    installErrorHandlers()
    initTheme()
    void initAccent()
    void initThemePacks()
    initTray()
    initMusic()
    initSounds()
    void initDesktopToasts()
    initDeepLinks()
    initOverlayLink()
    initInstalls()
    initCalls()
    void bootUpdate().then((leaving) => {
      if (leaving) return
      preloadScreens()
    })
    const updPoll = setInterval(() => {
      if (!updateReady()) void autoUpdate()
    }, 1_800_000)
    // The launcher can sit in the tray longer than an MC token lives, so refresh
    // near-expiry accounts periodically.
    const msPoll = setInterval(() => {
      void refreshMsAccounts()
    }, 1_800_000)
    const onVisible = () => {
      if (document.hidden) {
        void flushPrefs()
        return
      }
      void loadFriends()
      heartbeat()
    }
    document.addEventListener('visibilitychange', onVisible)
    const onLeave = () => void flushPrefs()
    window.addEventListener('pagehide', onLeave)
    const safety = setTimeout(hideBoot, 4000)
    // The "logged in at least once" flag lives in the durable prefs file, so the
    // disk copy has to land before boot decides whether this account may skip login.
    void Promise.all([initSecrets(), hydratePrefs()]).then(() => {
      clearTimeout(safety)
      const acc = getAccount()
      if (getMillidaAccount()) markMillidaEver()
      // Account present but its token did not survive a secret-storage migration:
      // clear the session once instead of showing a half-logged-in state everywhere.
      if (acc && isMillidaKind(acc.kind) && !hasMillidaAccount()) {
        logoutToLogin()
        showToast('После обновления войдите в Millida заново — один раз', 'error')
      } else if (acc && !millidaEver()) {
        logoutToLogin()
        showToast('Войди в аккаунт Millida — это нужно один раз', 'error')
      } else if (acc) enterApp()
      else logoutToLogin()
      void refreshProfiles()
      loadLiveRating()
      warmHeads(useAccounts.getState().list.filter((x) => !x.avatar).map((x) => x.nick))
      void loadFriends()
      void refreshGameNick()
      void refreshMsAccounts()
      void flushNativeCrashes()
      hideBoot()
      void initTelemetry(performance.now())
    })
    return () => {
      clearInterval(updPoll)
      clearInterval(msPoll)
      document.removeEventListener('visibilitychange', onVisible)
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
        if (updateReady()) {
          leaving = true
          e.preventDefault()
          await installUpdateOnExit()
          return
        }
        if (!trayCloseEnabled()) return
        e.preventDefault()
        hideLauncherToTray()
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
      if (!useUi.getState().logged) return
      logoutToLogin()
      showToast('Сессия истекла — войди заново', 'error')
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
    const t = setInterval(() => {
      if (document.hidden) return
      if (useUi.getState().screen === 'friends') {
        void loadFriends()
        void loadRooms()
      }
    }, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    // The backend keeps a friend online for 60s after the last beat, so beating
    // faster than 45s is pointless; hidden windows only slow down, never stop.
    let lastBeat = 0
    const t = setInterval(() => {
      const quiet = document.hidden && !gameSession()
      if (Date.now() - lastBeat < (quiet ? 55000 : 45000)) return
      lastBeat = Date.now()
      void reconcileGameSession().then(() => heartbeat('lobby'))
    }, 15000)
    const t0 = setTimeout(() => heartbeat('lobby'), 1500)
    syncRunningGame()
    let unlisten: (() => void) | null = null
    const onGameStarted = () => {
      gameStartedAt = Date.now()
    }
    window.addEventListener('millida-game-started', onGameStarted)

    void listenGameExit((profile) => {
      track('game_exit', {}, { durationMs: gameStartedAt ? Date.now() - gameStartedAt : undefined })
      useGame.getState().removeRunning(profile)
      // A second copy may still be alive — only the last exit puts the launcher back into lobby.
      if (useGame.getState().list.length) {
        void refreshPlayStats()
        showToast('Игра «' + profile + '» закрыта')
        return
      }
      gameStartedAt = 0
      setGameSession(null)
      heartbeat('lobby')
      void refreshPlayStats()
      if (restoreOnGameExit()) restoreLauncher()
      showToast('Игра закрыта')
    }).then((u) => {
      unlisten = u
    })
    let unServer: UnlistenFn | null = null
    void listenGameServer((addr) => {
      const name = addr ? serverNameFor(addr) : ''
      if (addr && name) rememberServerName(addr, name)
      updateSessionServer(addr || null, name || null)
      void refreshPlayStats()
    }).then((u) => {
      unServer = u
    })
    let unCrash: UnlistenFn | null = null
    void listenGameCrash((info) => {
      track('game_crash', { code: String((info as { reason?: string })?.reason ?? 'crash').slice(0, 120) }, { ok: false })
      useCrash.getState().show(info)
    }).then((u) => {
      unCrash = u
    })
    return () => {
      window.removeEventListener('millida-game-started', onGameStarted)
      clearInterval(t)
      clearTimeout(t0)
      if (unlisten) unlisten()
      if (unServer) unServer()
      if (unCrash) unCrash()
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
    const loop = async () => {
      if (stopped) return
      if (hasMillidaAccount()) {
        try {
          const r = await api('/friends/poll?since=' + since)
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
                    nick: x.nickname || 'Игрок',
                    text: 'Хочет добавить тебя в друзья',
                    kind: 'request',
                    actionLabel: 'Открыть заявки',
                    action: () => setScreen('friends'),
                  }),
                )
          }
          ;(r.messages || []).forEach((m: PolledMessage) => {
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
                if (!showDesktopToast(card) && useGame.getState().list.length)
                  void overlayNotify(card).catch(() => {})
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
        } catch {}
      }
      timer = setTimeout(loop, document.hidden ? 30000 : 5000)
    }
    const wake = () => {
      if (document.hidden) return
      clearTimeout(timer)
      timer = setTimeout(loop, 200)
    }
    document.addEventListener('visibilitychange', wake)
    timer = setTimeout(loop, 3000)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  useEffect(() => {
    if (logged) startMusicAfterLogin()
  }, [logged])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const f = useFriends.getState()
      if (f.chatOpen) {
        f.set({ chatOpen: false })
        return
      }
      closeModal('accModal')
      closeModal('nbModal')
      closeModal('bsModal')
      useWallpaper.getState().setPopOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <SvgSprite />
      <BootUpdate />
      <div className="window" id="win">
        <Titlebar />
        <UpdateBanner />

        <Login on={!logged} />

        <div className="app" id="scr-app" style={{ display: logged ? 'flex' : 'none' }}>
          <Sidebar
            onNav={(s) => {
              track('screen_view', { screen: s })
              if (s === 'hosting') track('hosting_open', {})
              if (s === 'servers') track('rating_open', {})
              if (s === 'mods') useMods.getState().scopeTo(null)
              setScreen(s)
              const c = document.querySelector('.content')
              if (c) c.scrollTop = 0
            }}
          />
          <main className="content">
            {/* Navigation runs in a transition, so the fallback only ever shows on
                the very first render. */}
            <Suspense fallback={null}>
              {screen === 'play' && <Play on />}
              {screen === 'builds' && <Builds on />}
              {screen === 'servers' && <Servers on />}
              {screen === 'mods' && <Mods on />}
              {screen === 'skins' && <Skins on />}
              {screen === 'friends' && <Friends on />}
              {screen === 'hosting' && <Hosting on />}
              {screen === 'settings' && <Settings on />}
            </Suspense>
          </main>
        </div>

        {instanceMounted && (
          <Suspense fallback={null}>
            <InstancePage />
          </Suspense>
        )}
        <ImportModal />
        <ProjectModal />
        <NewBuildModal />
        <Chat />
        <AccountAddModal />
        <ScreenshotsOverlay />
        <ModpackVersionsOverlay />
        <BuildPicker />
        <DepPlanModal />
        <CrashModal />
        <ServerDetail />
        <ChatNotify />
        <CallPanel />
        <RoomModals />
        {/* Mounted last: it asks on top of any other modal, and DOM order breaks
            ties between equal z-index values. */}
        <ConfirmModal />
        <ImageLightbox />
        <OnboardingModal />
        <Tour />
        <Installs />
        <Toast />
      </div>
    </>
  )
}
