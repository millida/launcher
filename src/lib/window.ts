import { hasTauri, tauri } from '../ipc/tauri'
import { hideToTray, setRestoreOnExitNative, showFromTray, trayAvailable } from '../ipc/commands'
import { suspendMusic } from '../state/music'
import { showToast } from '../state/ui'

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

function hideWindow() {
  if (localStorage.getItem(HINT_KEY) === '1') {
    void hideToTray().catch(minimizeWindow)
    return
  }
  localStorage.setItem(HINT_KEY, '1')
  showToast('Лаунчер убрался в трей — иконка рядом с часами, выход в меню по правому клику')
  setTimeout(() => {
    void hideToTray().catch(minimizeWindow)
  }, 2200)
}

export function hideLauncherToTray() {
  if (!hasTauri()) return
  if (trayReady) {
    // The hint toast delays the hide, but the user already asked to leave.
    suspendMusic()
    hideWindow()
  }
  else minimizeWindow()
}

export function applyLaunchWindowMode() {
  if (!hasTauri()) return
  const mode = launchWindowMode()
  if (mode === 'none') return
  if (mode === 'tray') hideLauncherToTray()
  else minimizeWindow()
}

export function restoreLauncher() {
  if (!hasTauri()) return
  void showFromTray().catch(() => {})
}
