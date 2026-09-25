import { tauri } from './tauri'
import type { UnlistenFn } from './tauri'

export interface LaunchProgress {
  stage: string
  pct: number
  msg: string
}

export function listenLaunchProgress(handler: (p: LaunchProgress) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<LaunchProgress>('launch-progress', (e) => handler(e.payload)).catch(() => null)
}

export function listenLaunchWarning(handler: (msg: string) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<string>('launch-warning', (e) => handler(e.payload)).catch(() => null)
}

export interface InstallProgress {
  key: string
  title: string
  pct: number
  msg: string
  done: boolean
  error: string
}

export function listenInstallProgress(handler: (p: InstallProgress) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<InstallProgress>('install-progress', (e) => handler(e.payload)).catch(() => null)
}

export interface DroppedPack {
  id: number
  name: string
}

export function listenPackDrag(handler: (over: boolean) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<boolean>('pack-drag', (e) => handler(e.payload)).catch(() => null)
}

export function listenPackDrop(handler: (packs: DroppedPack[]) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<DroppedPack[]>('pack-drop', (e) => handler(e.payload || [])).catch(() => null)
}

export function listenGameExit(handler: (profile: string) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<string>('game-exit', (e) => handler(e.payload)).catch(() => null)
}

// The core gives the frontend ~1.5s to install a staged update before it exits.
export function listenTrayExit(handler: () => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen('tray-exit', () => handler()).catch(() => null)
}

export function listenWindowVisibility(handler: (visible: boolean) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<boolean>('window-visibility', (e) => handler(e.payload)).catch(() => null)
}

export function listenDragDrop(handler: (paths: string[]) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T || !T.event) return Promise.resolve(null)
  return T.event
    .listen<{ paths?: string[] } | string[]>('tauri://drag-drop', (e) => {
      const p = e.payload as any
      handler((p && (p.paths || p)) || [])
    })
    .catch(() => null)
}

// Highlight state for the drop zone: enter/leave fire around the actual drop.
export function listenDragState(handler: (active: boolean) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T || !T.event) return Promise.resolve(null)
  return Promise.all([
    T.event.listen('tauri://drag-enter', () => handler(true)),
    T.event.listen('tauri://drag-leave', () => handler(false)),
    T.event.listen('tauri://drag-drop', () => handler(false)),
  ])
    .then((subs) => () => subs.forEach((u) => u()))
    .catch(() => null)
}

export function listenHostConsole(handler: (line: string) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<string>('host-console', (e) => handler(e.payload)).catch(() => null)
}

/// End of the log the node replays on connect. What came before it is history
/// the server had already written, what comes after is live.
export function listenHostConsoleReplayEnd(handler: () => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen('host-console-replay-end', () => handler()).catch(() => null)
}

// The core batches lines; a bare string is still accepted for older core builds.
export function listenGameLog(handler: (lines: string[]) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event
    .listen<string | string[]>('game-log', (e) => handler(Array.isArray(e.payload) ? e.payload : [e.payload]))
    .catch(() => null)
}

// Адрес сервера, на котором игрок прямо сейчас; пустая строка — меню или одиночная игра.
export function listenGameServer(handler: (addr: string) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<string>('game-server', (e) => handler(e.payload || '')).catch(() => null)
}

export function listenGameLogStart(handler: (profile: string) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<string>('game-log-start', (e) => handler(e.payload)).catch(() => null)
}

export interface CrashAction {
  kind: string
  label: string
  arg?: string
  hint?: string
}

export interface CrashInfo {
  profile: string
  reason: string
  tail: string
  culprits?: string[]
  actions?: CrashAction[]
  /// Устойчивый класс вылета из ядра (own_mod, missing_deps, oom, …).
  kind?: string
  /// Первая осмысленная строка исключения (≤300), пути и ник уже вычищены ядром.
  cause?: string
}
export interface PackAccessLost {
  profile: string
  message: string
  removed: boolean
}
export function listenPackAccessLost(handler: (info: PackAccessLost) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<PackAccessLost>('pack-access-lost', (e) => handler(e.payload)).catch(() => null)
}
export function listenGameCrash(handler: (info: CrashInfo) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<CrashInfo>('game-crash', (e) => handler(e.payload)).catch(() => null)
}
