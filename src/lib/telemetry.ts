import { hasTauri } from '../ipc/tauri'
import { appVersion, deviceSpecs, millidaApi } from '../ipc/commands'
import { LAUNCHER_API, apiHeaders } from './api'
import { detectGpu } from './gpu'
import { errorCode, scrubText } from './telemetryPrivacy'
import { classifyError, type ErrorKind } from './errorKind'

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
  | 'skin_diag'
  | 'account_link'
  | 'hosting_open'
  | 'hosting_action'
  | 'rating_open'
  | 'store_open'
  | 'pack_buy_click'
  | 'ui_click'
  | 'impression'
  | 'catalog_search'
  | 'catalog_install'
  | 'mode_open'
  | 'purchase_start'
  | 'purchase_result'
  | 'feedback_send'
  | 'update_applied'
  | 'error'
  | 'perf'

interface QueuedEvent {
  type: TelemetryEventType
  data?: Record<string, string | number | boolean>
  durationMs?: number
  ok?: boolean
  /// Когда событие случилось (мс): очередь уходит пачкой раз в 2 минуты или
  /// на следующем запуске, и время приёма сервером — не время события.
  at?: number
  /// Версия, которая событие записала: очередь переживает обновление.
  appVersion?: string
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
let loaded = false
/// События, записанные до того, как ядро назвало версию: получат её в initDevice.
let unstamped: QueuedEvent[] = []
let flushing: Promise<void> | null = null
let flushAgain = false
let inited = false
let exitTracked = false
let exitEvent: QueuedEvent | null = null
let timer: number | null = null
let started = 0
let lastBeatAt = 0
let lastBeatStatus: 'idle' | 'playing' | null = null

/// Окно оверлея — та же страница под другим хэшем и с тем же localStorage:
/// его запись очереди затирала очередь главного окна, а само оно её не отправляет.
function isOverlayWindow(): boolean {
  try {
    return typeof location !== 'undefined' && location.hash.replace('#', '').split('?')[0] === 'overlay'
  } catch {
    return false
  }
}

function saveQueue() {
  try {
    if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)))
    else localStorage.removeItem(QUEUE_KEY)
  } catch {}
}

/// Сохранённая очередь читается один раз и до первой записи: раньше track()
/// до initTelemetry перезаписывал её своими событиями, а init склеивал
/// сохранённое с памятью — и те же события уходили дважды.
function ensureLoaded() {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved))
      queue = saved
        .filter((e) => e && typeof e.type === 'string')
        .slice(-MAX_QUEUE)
        .concat(queue)
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
  if (!on) {
    queue = []
    unstamped = []
    saveQueue()
  }
}

export function installId(): string {
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
  for (const e of unstamped) e.appVersion = base.appVersion
  unstamped = []
  return base
}

export function setInventory(buildsCount: number, modsCount: number) {
  inventory = { buildsCount, modsCount }
  if (!device) return
  device.buildsCount = buildsCount
  device.modsCount = modsCount
}

/// The collector still expects the appearance fields; the launcher has a single
/// dark look now, so they are constant.
const APPEARANCE = { themePack: '', themeMode: 'dark' } as const

/// Sent through the core (reqwest) rather than fetch: the webview origin tauri://localhost is
/// blocked by CORS.
async function send(events: QueuedEvent[]): Promise<boolean> {
  const dev = await initDevice()
  const payload = { device: { ...dev, ...APPEARANCE }, events }
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

async function flushOnce(): Promise<void> {
  ensureLoaded()
  if (!telemetryEnabled() || queue.length === 0) return
  const batch = queue.slice(0, 100)
  const ok = await send(batch)
  // Убираем именно отправленные: пока шёл запрос, очередь могла подрезаться.
  if (ok) {
    const sent = new Set(batch)
    queue = queue.filter((e) => !sent.has(e))
  }
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE)
  saveQueue()
}

/// Одна отправка за раз: таймер, скрытие окна, выход и переполнение очереди
/// звали её одновременно — одна пачка уходила дважды, а потом дважды
/// отрезалась от очереди и терялись чужие события. Вызов во время отправки
/// просит ещё один круг после неё.
export function flushTelemetry(): Promise<void> {
  if (flushing) {
    flushAgain = true
    return flushing
  }
  flushing = (async () => {
    try {
      do {
        flushAgain = false
        await flushOnce()
      } while (flushAgain && queue.length > 0 && telemetryEnabled())
    } finally {
      flushing = null
    }
  })()
  return flushing
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
  push(type, data, extra)
}

function push(
  type: TelemetryEventType,
  data?: Record<string, string | number | boolean>,
  extra?: { durationMs?: number; ok?: boolean },
): QueuedEvent | null {
  if (!telemetryEnabled() || isOverlayWindow()) return null
  ensureLoaded()
  // Домашняя папка и токены в любом текстовом поле (коды ошибок, пути) не уходят наружу.
  if (data)
    data = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? scrubText(v) : v]))
  const ev: QueuedEvent = { type, data, durationMs: extra?.durationMs, ok: extra?.ok, at: Date.now() }
  if (device) ev.appVersion = device.appVersion
  else unstamped.push(ev)
  queue.push(ev)
  saveQueue()
  if (queue.length >= MAX_QUEUE) void flushTelemetry()
  return ev
}

const EXIT_SURVIVED_MS = 1500

/// Выход из лаунчера — одно событие на запуск страницы. Зовётся из pagehide,
/// beforeunload, выхода из трея и перед установкой обновления.
export function trackAppExit(opts?: { maybeCancelled?: boolean; flush?: boolean }) {
  if (exitTracked || !started) return
  const seconds = Math.round((Date.now() - started) / 1000)
  const ev = push('app_exit', {}, { durationMs: seconds * 1000 })
  if (!ev) return
  exitTracked = true
  exitEvent = ev
  if (opts?.flush !== false) void flushTelemetry()
  if (!opts?.maybeCancelled) return
  // beforeunload срабатывает и на переход, который navguard потом отменяет
  // (ссылка без target в описании мода): окно живёт дальше. Если страница
  // пережила полторы секунды — выхода не было, событие забираем назад.
  setTimeout(cancelAppExit, EXIT_SURVIVED_MS)
}

/// Выхода не случилось (установка обновления сорвалась, переход отменён):
/// ещё не отправленный app_exit забираем.
export function cancelAppExit() {
  const ev = exitEvent
  if (!ev || !queue.includes(ev)) return
  queue = queue.filter((e) => e !== ev)
  exitEvent = null
  exitTracked = false
  saveQueue()
}

export function trackTimed(type: TelemetryEventType, startedAt: number, data?: Record<string, string | number | boolean>, ok = true) {
  track(type, data, { durationMs: Math.max(0, Math.round(performance.now() - startedAt)), ok })
}

const FAILURE_REPEAT_MS = 60_000
const failureSeen = new Map<string, number>()

// Ожидаемое состояние, а не сбой: игрок отменил или сессия кончилась.
const EXPECTED_FAILURE = /\bunauthorized\b|\bhttp 401\b|не авторизован/i

/// Сбой сценария одним событием `error {where, code, kind}`: текст без путей и
/// токенов, класс — из classifyError. Одинаковый where+code чаще раза в минуту
/// не пишется. Отмена и истёкшая сессия — не сбой.
export function trackFailure(
  where: string,
  err: unknown,
  extra?: Record<string, string | number | boolean | null | undefined>,
): ErrorKind | null {
  const text = errText(err)
  const kind = classifyError(text)
  if (kind === 'cancelled' || EXPECTED_FAILURE.test(text)) return null
  if (!telemetryEnabled()) return kind
  const code = errorCode(text)
  const key = where + '\n' + code
  const now = Date.now()
  const last = failureSeen.get(key)
  if (last !== undefined && now - last < FAILURE_REPEAT_MS) return kind
  failureSeen.set(key, now)
  const data: Record<string, string | number | boolean> = { where, code, kind }
  if (extra) for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== '') data[k] = v
  track('error', data, { ok: false })
  return kind
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string')
    return (err as { message: string }).message
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/// Только для тестов: чистое состояние модуля.
export function __resetTelemetryForTests() {
  queue = []
  loaded = false
  unstamped = []
  flushing = null
  flushAgain = false
  inited = false
  exitTracked = false
  exitEvent = null
  started = 0
  device = null
  failureSeen.clear()
}

export async function initTelemetry(bootMs: number): Promise<void> {
  if (!telemetryEnabled() || inited || isOverlayWindow()) return
  // Один раз на страницу: повторный вызов вешал бы ещё один слушатель выхода.
  inited = true
  started = Date.now()
  ensureLoaded()
  await initDevice()
  track('app_start', {}, { durationMs: Math.round(bootMs) })
  void liveBeat('idle', undefined, true)
  if (timer === null) {
    timer = window.setInterval(() => void flushTelemetry(), FLUSH_MS)
  }
  // Раньше app_exit писался на каждый beforeunload, а тот срабатывает и на
  // отменённые navguard переходы — отсюда по нескольку app_exit в пачке.
  // beforeunload только записывает (на диск, уйдёт при следующем запуске, если
  // окно правда закрылось), отправка — на pagehide.
  window.addEventListener('beforeunload', () => trackAppExit({ maybeCancelled: true, flush: false }))
  window.addEventListener('pagehide', () => {
    trackAppExit()
    void flushTelemetry()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushTelemetry()
  })
  void flushTelemetry()
}
