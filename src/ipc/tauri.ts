import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

export type TauriEvent<T> = { payload: T }
export type UnlistenFn = () => void
export interface CloseRequestedEvent {
  preventDefault(): void
}

export interface TauriGlobal {
  core: {
    invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>
    convertFileSrc?: (path: string) => string
  }
  event: {
    listen<T = unknown>(name: string, handler: (e: TauriEvent<T>) => void): Promise<UnlistenFn>
  }
  window?: {
    getCurrentWindow(): {
      minimize(): Promise<void>
      toggleMaximize(): Promise<void>
      close(): Promise<void>
      destroy?(): Promise<void>
      onCloseRequested?(handler: (e: CloseRequestedEvent) => void | Promise<void>): Promise<UnlistenFn>
    }
  }
}

// Imported from the packages rather than window.__TAURI__: exposing the global
// would hand any XSS in the webview full IPC access, secrets included.
const api = {
  core: { invoke, convertFileSrc },
  event: { listen },
  window: { getCurrentWindow },
} as unknown as TauriGlobal

// window.isTauri only exists with withGlobalTauri enabled, so probe the bridge.
export const hasTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const tauri = (): TauriGlobal | null => (hasTauri() ? api : null)
