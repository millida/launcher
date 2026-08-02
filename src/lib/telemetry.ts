import { hasTauri } from '../ipc/tauri'
import { appVersion, deviceSpecs, millidaApi } from '../ipc/commands'
import { LAUNCHER_API, apiHeaders } from './api'
import { detectGpu } from './gpu'

export type TelemetryEventType =
  | 'app_start'
  | 'app_exit'
  | 'game_launch'
  | 'game_exit'
  | 'game_crash'
  | 'build_create'
  | 'build_import'
  | 'build_delete'
  | 'content_install'
  | 'content_update'
  | 'modpack_install'
  | 'screen_view'
  | 'server_join'
  | 'skin_apply'
  | 'account_link'
  | 'hosting_open'
  | 'hosting_action'
  | 'rating_open'
  | 'store_open'
  | 'update_applied'
  | 'error'
  | 'perf'

interface QueuedEvent {
  type: TelemetryEventType
  data?: Record<string, string | number | boolean>
  durationMs?: number
  ok?: boolean
}

interface Device {
  installId: string
  sessionId: string
  os: string
  osVersion?: string
  arch?: string
  appVersion: string
  locale?: string
  timezone?: string
  cpu?: string
  cpuCores?: number
  cpuThreads?: number
  ramMb?: number
  gpu?: string
  screen?: string
  buildsCount?: number
  modsCount?: number
}

const ID_KEY = 'm-install-id'
const OPT_OUT_KEY = 'm-telemetry-off'
const QUEUE_KEY = 'm-telemetry-queue'
const FLUSH_MS = 120_000
const MAX_QUEUE = 200
const BEAT_MIN_MS = 40_000

let device: Device | null = null
let inventory: { buildsCount: number; modsCount: number } | null = null
let queue: QueuedEvent[] = []
let timer: number | null = null
let started = 0
let lastBeatAt = 0
let lastBeatStatus: 'idle' | 'playing' | null = null

function saveQueue() {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)))
    else localStorage.removeItem(QUEUE_KEY)
  } catch {}
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved)) queue = saved.slice(-MAX_QUEUE).concat(queue)
  } catch {}
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'i' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function telemetryEnabled(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== '1'
  } catch {
    return true
  }
}

export function setTelemetryEnabled(on: boolean) {
  try {
    localStorage.setItem(OPT_OUT_KEY, on ? '0' : '1')
  } catch {}
  if (!on) queue = []
}

function installId(): string {
  try {
    const cur = localStorage.getItem(ID_KEY)
    if (cur) return cur
    const next = uuid()
    localStorage.setItem(ID_KEY, next)
    return next
  } catch {
    return uuid()
  }
}

function fallbackOs(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  return 'linux'
}

async function initDevice(): Promise<Device> {
  if (device) return device
  const base: Device = {
    installId: installId(),
    sessionId: uuid(),
    os: fallbackOs(),
    appVersion: '0.0.0',
    locale: navigator.language?.slice(0, 16),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64),
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    gpu: detectGpu(),
  }
  if (hasTauri()) {
    try {
      base.appVersion = await appVersion()
    } catch {}
    try {
      const s = await deviceSpecs()
      base.os = s.os || base.os
      base.osVersion = s.os_version || undefined
      base.arch = s.arch || undefined
      base.cpu = s.cpu || undefined
      base.cpuCores = s.cpu_cores || undefined
      base.cpuThreads = s.cpu_threads || undefined
      base.ramMb = s.ram_mb || undefined
    } catch {}
  }
  if (inventory) {
    base.buildsCount = inventory.buildsCount
    base.modsCount = inventory.modsCount
  }
  device = base
  return base
}

export function setInventory(buildsCount: number, modsCount: number) {
  inventory = { buildsCount, modsCount }
  if (!device) return
  device.buildsCount = buildsCount
  device.modsCount = modsCount
}

/// Sent through the core (reqwest) rather than fetch: the webview origin tauri://localhost is
/// blocked by CORS.
async function send(events: QueuedEvent[]): Promise<boolean> {
  const dev = await initDevice()
  const payload = { device: dev, events }
  if (hasTauri()) {
    try {
      await millidaApi('/launcher/telemetry', 'POST', payload)
      return true
    } catch {
      return false
    }
  }
  try {
    const res = await fetch(LAUNCHER_API + '/launcher/telemetry', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(payload),
      keepalive: events.length <= 20,
    })
    return res.ok
  } catch {
    return false
  }
}

export async function flushTelemetry(): Promise<void> {
  if (!telemetryEnabled() || queue.length === 0) return
  const batch = queue.slice(0, 100)
  const ok = await send(batch)
  if (ok) queue = queue.slice(batch.length)
  else if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE)
  saveQueue()
}

export async function liveBeat(
  status: 'idle' | 'playing',
  meta?: { build?: string | null; mc?: string | null; server?: string | null },
  force = false,
): Promise<void> {
  if (!telemetryEnabled()) return
  const now = Date.now()
  if (!force && status === lastBeatStatus && now - lastBeatAt < BEAT_MIN_MS) return
  lastBeatAt = now
  lastBeatStatus = status
  const dev = await initDevice()
  const payload = {
    installId: dev.installId,
    status,
    os: dev.os,
    appVersion: dev.appVersion,
    locale: dev.locale,
    timezone: dev.timezone,
    build: (meta && meta.build) || undefined,
    mc: (meta && meta.mc) || undefined,
    server: (meta && meta.server) || undefined,
  }
  if (hasTauri()) {
    try {
      await millidaApi('/launcher/heartbeat', 'POST', payload)
    } catch {}
    return
  }
  try {
    await fetch(LAUNCHER_API + '/launcher/heartbeat', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(payload),
    })
  } catch {}
}

export function track(
  type: TelemetryEventType,
  data?: Record<string, string | number | boolean>,
  extra?: { durationMs?: number; ok?: boolean },
) {
  if (!telemetryEnabled()) return
  queue.push({ type, data, durationMs: extra?.durationMs, ok: extra?.ok })
  saveQueue()
  if (queue.length >= MAX_QUEUE) void flushTelemetry()
}

export function trackTimed(type: TelemetryEventType, startedAt: number, data?: Record<string, string | number | boolean>, ok = true) {
  track(type, data, { durationMs: Math.max(0, Math.round(performance.now() - startedAt)), ok })
}

export async function initTelemetry(bootMs: number): Promise<void> {
  if (!telemetryEnabled()) return
  started = Date.now()
  loadQueue()
  await initDevice()
  track('app_start', {}, { durationMs: Math.round(bootMs) })
  void liveBeat('idle', undefined, true)
  if (timer === null) {
    timer = window.setInterval(() => void flushTelemetry(), FLUSH_MS)
  }
  window.addEventListener('beforeunload', () => {
    const seconds = Math.round((Date.now() - started) / 1000)
    track('app_exit', {}, { durationMs: seconds * 1000 })
    void flushTelemetry()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushTelemetry()
  })
  void flushTelemetry()
}
