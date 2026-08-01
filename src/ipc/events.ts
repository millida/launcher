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

export function listenHostConsole(handler: (line: string) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<string>('host-console', (e) => handler(e.payload)).catch(() => null)
}

// The core batches lines; a bare string is still accepted for older core builds.
export function listenGameLog(handler: (lines: string[]) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event
    .listen<string | string[]>('game-log', (e) => handler(Array.isArray(e.payload) ? e.payload : [e.payload]))
    .catch(() => null)
}

export function listenGameLogStart(handler: (profile: string) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<string>('game-log-start', (e) => handler(e.payload)).catch(() => null)
}

export interface CrashInfo { profile: string; reason: string; tail: string }
export function listenGameCrash(handler: (info: CrashInfo) => void): Promise<UnlistenFn | null> {
  const T = tauri()
  if (!T) return Promise.resolve(null)
  return T.event.listen<CrashInfo>('game-crash', (e) => handler(e.payload)).catch(() => null)
}
