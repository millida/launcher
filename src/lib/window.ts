import { hasTauri, tauri } from '../ipc/tauri'
import { hideToTray, mainWindowVisible, setRestoreOnExitNative, showFromTray, trayAvailable, unloadMainWindow } from '../ipc/commands'
import { suspendMusic } from '../state/music'
import { showToast, useUi } from '../state/ui'
import { t } from '../i18n'
import { flushTelemetry } from './telemetry'
import { flushPrefs } from './prefs'
import { currentHold, watchHolds } from './unloadHold'

const FLUSH_BUDGET_MS = 1500
let stopWatch: (() => void) | null = null

export type LaunchWindowMode = 'none' | 'minimize' | 'tray'

const MODE_KEY = 'm-launch-window'
const LEGACY_KEY = 'm-minimize'
const CLOSE_KEY = 'm-tray-close'
const RESTORE_KEY = 'm-restore-exit'
const HINT_KEY = 'm-tray-hint'

let trayReady = false

export const hasTray = () => trayReady

export function initTray() {
  if (!hasTauri()) return
  void trayAvailable()
    .then((ok) => {
      trayReady = ok
    })
    .catch(() => {})
  void setRestoreOnExitNative(restoreOnGameExit()).catch(() => {})
}

export function launchWindowMode(): LaunchWindowMode {
  const v = localStorage.getItem(MODE_KEY)
  if (v === 'none' || v === 'minimize' || v === 'tray') return v
  return localStorage.getItem(LEGACY_KEY) === '0' ? 'none' : 'minimize'
}

export function setLaunchWindowMode(mode: LaunchWindowMode) {
  localStorage.setItem(MODE_KEY, mode)
  localStorage.setItem(LEGACY_KEY, mode === 'none' ? '0' : '1')
}

export const trayCloseEnabled = () => trayReady && localStorage.getItem(CLOSE_KEY) !== '0'

export const setTrayClose = (on: boolean) => localStorage.setItem(CLOSE_KEY, on ? '1' : '0')

export const restoreOnGameExit = () => localStorage.getItem(RESTORE_KEY) !== '0'

export function setRestoreOnGameExit(on: boolean) {
  localStorage.setItem(RESTORE_KEY, on ? '1' : '0')
  if (hasTauri()) void setRestoreOnExitNative(on).catch(() => {})
}

function minimizeWindow() {
  const T = tauri()
  const w = T && T.window ? T.window.getCurrentWindow() : null
  if (w && w.minimize) void w.minimize().catch(() => {})
}

/// Out of sight the window is destroyed with its whole WebView2 tree; the tray
/// click builds it again on the screen it left (the core keeps the screen). What
/// would be cut — an install the page drives, a call — parks the window instead,
/// and it goes as soon as that is over.
///
/// The cross takes the window off the screen first, at once; sending the queues (up to 1.5 s) and the unload come
/// after. Before, they came first and the window hung on the screen for up to a second and a half after the click
/// (R9 of the first review, still open in the second).
async function unloadLauncher(reason: 'tray' | 'game') {
  stopWatch?.()
  stopWatch = null
  const hold = currentHold()
  const hidden = await hideAtOnce()
  // The queue survives in localStorage, but sending now saves a late batch.
  await Promise.race([
    Promise.allSettled([flushTelemetry(), flushPrefs()]),
    new Promise((resolve) => setTimeout(resolve, FLUSH_BUDGET_MS)),
  ])
  // The player came back through the tray while the queues were going out: the window is theirs again.
  if (hidden && (await mainWindowVisible().catch(() => false))) return
  try {
    await unloadMainWindow(reason, hold, useUi.getState().screen)
  } catch {
    void hideToTray().catch(minimizeWindow)
    return
  }
  if (hold) watchHold(reason)
}

/// True when the core hid the window; false when it could not and the window was minimized instead (a minimized
/// window still counts as visible to the core, so the "came back" check below must not trust it then).
function hideAtOnce(): Promise<boolean> {
  return hideToTray().then(
    () => true,
    () => {
      minimizeWindow()
      return false
    },
  )
}

function watchHold(reason: 'tray' | 'game') {
  let done = false
  let off: (() => void) | null = null
  const stop = () => {
    done = true
    off?.()
  }
  const check = () => {
    if (done || currentHold()) return
    stop()
    if (stopWatch === stop) stopWatch = null
    // Opened again meanwhile: the player is back, nothing to unload.
    void mainWindowVisible()
      .then((visible) => {
        if (!visible) void unloadLauncher(reason)
      })
      .catch(() => {})
  }
  off = watchHolds(check)
  stopWatch = stop
  check()
}

function hideWindow(reason: 'tray' | 'game') {
  if (localStorage.getItem(HINT_KEY) === '1') {
    void unloadLauncher(reason)
    return
  }
  localStorage.setItem(HINT_KEY, '1')
  showToast(t('Лаунчер убрался в трей — иконка рядом с часами, выход в меню по правому клику'))
  setTimeout(() => {
    void unloadLauncher(reason)
  }, 2200)
}

export function hideLauncherToTray() {
  if (!hasTauri()) return
  if (trayReady) {
    // The hint toast delays the hide, but the user already asked to leave.
    suspendMusic()
    hideWindow('tray')
  }
  else minimizeWindow()
}

/// The game is up: «свернуть» and «в трей» both unload the window now (decision
/// of 26.10.2026) — a minimized window still kept 5–8 WebView2 processes under
/// the game. Without a tray icon there is no way back, so it is minimized.
export function applyLaunchWindowMode() {
  if (!hasTauri()) return
  const mode = launchWindowMode()
  if (mode === 'none') return
  if (!trayReady) {
    minimizeWindow()
    return
  }
  suspendMusic()
  hideWindow('game')
}

export function restoreLauncher() {
  if (!hasTauri()) return
  stopWatch?.()
  stopWatch = null
  void showFromTray().catch(() => {})
}
