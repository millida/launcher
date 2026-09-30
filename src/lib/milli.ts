import { api, LAUNCHER_API, apiHeaders } from './api'
import { hasTauri } from '../ipc/tauri'
import { DEMO_USER } from './demo'
import { LOCKED_SLUGS } from './aiBuilder'
import type { PlanItem } from '../ipc/commands'

/*
 * Милли — ИИ-сборщик чатом. Клиент адресов `/catalog/milli/*` (контракт —
 * milli/CONTRACT.md бэкенда feat/milli-ai). Все адреса требуют вход в аккаунт
 * Millida: без него запросы не шлём, показываем «Войди в аккаунт».
 */

export type MilliLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt'

export interface MilliCounter {
  used: number
  limit: number
  remaining: number
  /** ISO, UTC. */
  resetAt: string
}

export interface MilliStatus {
  enabled: boolean
  blocked: boolean
  plus: boolean
  day: MilliCounter
  month: MilliCounter
  /** `enhanced` — «Улучшенная сборка» (PLUS): второй проход проверки. Старый API поля не присылает. */
  features: { extras: boolean; server: boolean; enhanced?: boolean }
}

export interface MilliItem {
  projectId: string
  slug: string
  title: string
  icon: string | null
  why: string
  base: boolean
  source: 'modrinth'
}

export interface MilliCatalogItem {
  slug: string
  title: string
  icon: string | null
  /** Путь сайта, например /maps/<slug>. */
  url: string
  section: string
}

export interface MilliLink {
  kind: 'seeds' | 'skins'
  title: string
  url: string
}

export interface MilliExcluded {
  slug: string
  title: string
  reason: string
  detail: string
}

export interface MilliPack {
  buildId: string
  title: string
  mcVersion: string
  loader: MilliLoader
  mods: MilliItem[]
  resourcepacks: MilliItem[]
  shaders: MilliItem[]
  shaderLoader: MilliItem | null
  maps: MilliCatalogItem[]
  links: MilliLink[]
  excluded: MilliExcluded[]
  notes: string
  locked: { extras: boolean }
  /** Сборка прошла «Улучшенную» проверку: что Милли добавила и убрала. */
  review?: MilliReview | null
}

export interface MilliReview {
  added: { title: string }[]
  removed: { title: string; reason: string }[]
}

export interface MilliMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  pack: MilliPack | null
  suggestions: string[]
}

export interface MilliSessionHead {
  id: string
  title: string
  updatedAt: string
}

export interface MilliSession extends MilliSessionHead {
  messages: MilliMessage[]
}

export interface MilliReply {
  sessionId: string
  user: MilliMessage
  reply: MilliMessage
  status: MilliStatus
}

export interface MilliInstallAnswer {
  code: string
  url: string
  deeplink: string
  files: number
  mcVersion: string
  loader: string
  skipped: string[]
}

export interface MilliServerAnswer {
  installed: string[]
  skipped: { title: string; reason: string }[]
}

export const MILLI_TEXT_MAX = 800

export interface MilliPlanLimits {
  day: number
  month: number
}

export interface MilliPlans {
  free: MilliPlanLimits
  plus: MilliPlanLimits
}

/** Тарифная сетка на 30.09.2026 — пока не пришёл ответ `/catalog/milli/limits` или если он упал. */
export const MILLI_PLANS: MilliPlans = { free: { day: 5, month: 30 }, plus: { day: 100, month: 500 } }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function plan(raw: unknown, fallback: MilliPlanLimits): MilliPlanLimits {
  const r = obj(raw)
  return { day: num(r.day) ?? fallback.day, month: num(r.month) ?? fallback.month }
}

/**
 * Ответ публичного `GET /catalog/milli/limits` (`{ free: { day, month }, plus:
 * { day, month }, period, plusExtras }`) → тарифы для предложения PLUS. Лимиты
 * живые: бэкенд переопределяет их окружением, цифры не хардкодятся.
 */
export function milliPlans(raw: unknown): MilliPlans {
  const r = obj(raw)
  return { free: plan(r.free, MILLI_PLANS.free), plus: plan(r.plus, MILLI_PLANS.plus) }
}

export const LOADER_LABEL: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }

// ─── Ошибки ──────────────────────────────────────────────────────────────

export type MilliErrorKind = 'auth' | 'limit' | 'busy' | 'blocked' | 'off' | 'plus' | 'offline' | 'failed'

export interface MilliError {
  kind: MilliErrorKind
  /** Для лимита: какой счётчик кончился. */
  scope?: 'day' | 'month'
  /** Короткая фраза для пузыря Милли. */
  text: string
  /** Можно ли повторить тот же запрос. */
  retry: boolean
}

const ERROR_TEXT: Record<MilliErrorKind, string> = {
  auth: 'Войди в аккаунт Millida',
  limit: 'Лимит на сегодня',
  busy: 'Милли ещё думает над прошлым',
  blocked: 'Милли тебе недоступна',
  off: 'Милли отдыхает',
  plus: 'Это в PLUS',
  offline: 'Нет связи с Millida',
  failed: 'Милли не ответила',
}

const err = (kind: MilliErrorKind, scope?: 'day' | 'month'): MilliError => ({
  kind,
  ...(scope ? { scope } : {}),
  text: kind === 'limit' && scope === 'month' ? 'Лимит на месяц' : ERROR_TEXT[kind],
  retry: kind === 'failed' || kind === 'offline' || kind === 'busy',
})

const OFFLINE_RX = /нет связи|error sending request|failed to fetch|dns error|connection refused|connection reset|timed out|networkerror/i

/**
 * Разбор ошибки запроса. В приложении ядро отдаёт только `message` сервера
 * (без `code`), в браузере — «http 429 milli_limit day». Поэтому смотрим и на
 * код, и на статус, и на слова; точный ответ после сбоя даёт `/status`.
 */
export function milliError(e: unknown): MilliError {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '').replace(/^Error:\s*/, '').trim()
  const low = raw.toLowerCase()
  const status = Number(/\bhttp (\d{3})\b/.exec(low)?.[1] ?? 0)
  const scope: 'day' | 'month' | undefined = /\bmonth\b|месяц/.test(low) ? 'month' : /\bday\b|сегодня|сутки|день/.test(low) ? 'day' : undefined
  if (/milli_limit/.test(low)) return err('limit', scope ?? 'day')
  if (/milli_busy/.test(low)) return err('busy')
  if (/milli_plus/.test(low)) return err('plus')
  if (status === 401 || /^unauthorized$/.test(low) || /сессия millida/.test(low)) return err('auth')
  if (OFFLINE_RX.test(low)) return err('offline')
  if (status === 429) return /думает|busy/.test(low) ? err('busy') : err('limit', scope ?? 'day')
  if (/лимит|limit/.test(low)) return err('limit', scope ?? 'day')
  if (/думает/.test(low)) return err('busy')
  if (status === 403) return /plus/.test(low) ? err('plus') : err('blocked')
  if (/plus/.test(low) && /только|only/.test(low)) return err('plus')
  if (/заблок|blocked|banned/.test(low)) return err('blocked')
  if (status === 503 || /отдыхает|disabled|выключ/.test(low)) return err('off')
  return err('failed')
}

/**
 * Статус после сбоя точнее текста ошибки: исчерпан счётчик — карточка лимита,
 * выключена — «отдыхает». Ошибка того же рода остаётся как есть.
 */
export function refineMilliError(e: MilliError, s: MilliStatus | null): MilliError {
  if (!s || e.kind === 'auth' || e.kind === 'offline') return e
  if (!s.enabled) return err('off')
  if (s.blocked) return err('blocked')
  if (s.month.remaining <= 0) return err('limit', 'month')
  if (s.day.remaining <= 0) return err('limit', 'day')
  if (e.kind === 'limit') return err('failed')
  return e
}

// ─── Счётчик и время ─────────────────────────────────────────────────────

/** Сколько запросов осталось прямо сейчас: упирается в меньший из суточного и месячного. */
export function milliLeft(s: Pick<MilliStatus, 'day' | 'month'> | null): number | null {
  if (!s) return null
  return Math.max(0, Math.min(s.day.remaining, s.month.remaining))
}

/** Счётчик в шапке Милли (владелец 30.09 16:11: «маленький счётчик "осталось 5"», без простыни про тарифы). */
export function milliCounterChip(s: Pick<MilliStatus, 'day' | 'month'> | null): string | null {
  const left = milliLeft(s)
  return left === null ? null : 'осталось ' + left
}

/** «Улучшенная сборка» уходит на сервер только у PLUS: у бесплатного переключатель заперт. */
export function milliEnhancedOn(s: Pick<MilliStatus, 'plus' | 'features'> | null, wanted: boolean): boolean {
  return wanted && !!s?.plus && s.features?.enhanced !== false
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** Когда снова можно спросить: «через 40 мин», «через 5 ч», «через 3 дня». */
export function milliResetText(resetAt: string, now: number = Date.now()): string {
  const at = Date.parse(resetAt)
  if (!Number.isFinite(at)) return ''
  const ms = at - now
  if (ms <= 60_000) return 'через минуту'
  const min = Math.ceil(ms / 60_000)
  if (min < 60) return 'через ' + min + ' мин'
  const h = Math.round(min / 60)
  if (h < 24) return 'через ' + h + ' ч'
  const d = Math.round(h / 24)
  return 'через ' + d + ' ' + plural(d, 'день', 'дня', 'дней')
}

// ─── Сборка → установка ──────────────────────────────────────────────────

export interface MilliChosen {
  mods: MilliItem[]
  resourcepacks: MilliItem[]
  shaders: MilliItem[]
}

/** Базовые моды без галочки: без них моды загрузчика не стартуют. */
export const isLockedItem = (m: Pick<MilliItem, 'slug'>) => LOCKED_SLUGS.has(m.slug)

/**
 * Что ставим: отмеченное игроком, базовые — всегда. Базовые первыми (Fabric API
 * до модов, которые его требуют), загрузчик шейдеров — если отмечен хоть один
 * шейдер и его нет среди модов.
 */
export function milliChosen(pack: MilliPack, off: ReadonlySet<string>): MilliChosen {
  const keep = (list: MilliItem[] | undefined) => (list ?? []).filter((m) => isLockedItem(m) || !off.has(m.projectId))
  const mods = keep(pack.mods).sort((a, b) => Number(b.base) - Number(a.base))
  const shaders = keep(pack.shaders)
  const loader = pack.shaderLoader
  if (shaders.length && loader && !mods.some((m) => m.projectId === loader.projectId)) mods.push(loader)
  return { mods, resourcepacks: keep(pack.resourcepacks), shaders }
}

export const milliItems = (list: MilliItem[]): PlanItem[] => list.map((m) => ({ source: 'modrinth', project_id: m.projectId }))

/** Тело `POST /packs/:buildId/install`: код сборки для «Поделиться». */
export function milliInstallBody(pack: MilliPack, chosen: MilliChosen, name: string) {
  return {
    name: (name.trim() || pack.title).slice(0, 48),
    projectIds: chosen.mods.map((m) => m.projectId),
    ...(chosen.resourcepacks.length ? { resourcepackIds: chosen.resourcepacks.map((m) => m.projectId) } : {}),
    ...(chosen.shaders.length ? { shaderIds: chosen.shaders.map((m) => m.projectId) } : {}),
  }
}

/** Сколько всего строк можно отметить в карточке сборки. */
export const milliPackCount = (pack: MilliPack) => pack.mods.length + pack.resourcepacks.length + pack.shaders.length

/** Первое сообщение с версией и загрузчиком из «Новой сборки». */
export function withPreset(text: string, preset: { mcVersion?: string; loader?: string } | null): string {
  if (!preset || (!preset.mcVersion && !preset.loader)) return text
  const tag = [preset.mcVersion, preset.loader ? LOADER_LABEL[preset.loader] || preset.loader : ''].filter(Boolean).join(', ')
  return (text.trim() + ' (' + tag + ')').slice(0, MILLI_TEXT_MAX)
}

/** Адрес сайта для путей из ответа (`/maps/x`) и готовых ссылок. */
export const siteUrl = (path: string) => (/^https?:\/\//.test(path) ? path : 'https://millida.net' + (path.startsWith('/') ? '' : '/') + path)

// ─── Запросы ─────────────────────────────────────────────────────────────

/**
 * В приложении — `api()` через ядро с токеном. В dev-браузере без ядра —
 * свой fetch, чтобы `code` и `scope` из тела ошибки дошли до разбора.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.DEV && DEMO_USER && demoOn()) return demoRequest<T>(path, init)
  if (hasTauri() || !import.meta.env.DEV) return api<T>(path, init)
  const r = await fetch(LAUNCHER_API + path, { ...init, headers: apiHeaders() })
  if (!r.ok) {
    let tail = ''
    try {
      const b = (await r.json()) as { code?: string; scope?: string; message?: string }
      tail = [b.code, b.scope, b.message].filter(Boolean).join(' ')
    } catch {}
    throw new Error(('http ' + r.status + ' ' + tail).trim())
  }
  return r.json() as Promise<T>
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const milliStatus = () => request<MilliStatus>('/catalog/milli/status')
export const milliLimits = async (): Promise<MilliPlans> => milliPlans(await request<unknown>('/catalog/milli/limits'))
export const milliSessions = () => request<{ items: MilliSessionHead[] }>('/catalog/milli/sessions')
export const milliSession = (id: string) => request<MilliSession>('/catalog/milli/sessions/' + encodeURIComponent(id))
export const milliSend = (text: string, sessionId?: string | null, enhanced = false) =>
  request<MilliReply>(
    '/catalog/milli/messages',
    post({ ...(sessionId ? { sessionId } : {}), text: text.slice(0, MILLI_TEXT_MAX), client: 'launcher', ...(enhanced ? { enhanced: true } : {}) }),
  )
export const milliInstall = (buildId: string, body: ReturnType<typeof milliInstallBody>) =>
  request<MilliInstallAnswer>('/catalog/milli/packs/' + encodeURIComponent(buildId) + '/install', post(body))
export const milliToServer = (buildId: string, serverId: string, projectIds: string[]) =>
  request<MilliServerAnswer>('/catalog/milli/packs/' + encodeURIComponent(buildId) + '/server', post({ serverId, projectIds }))

// ─── Демо (?preview=user, только dev) ────────────────────────────────────
// Бэкенда Милли на проде ещё нет: демо отвечает сам. `&milli=live` выключает
// демо — запросы уходят на /papi (так их подменяют скриншоты Playwright).

function demoOn(): boolean {
  try {
    return new URLSearchParams(location.search).get('milli') !== 'live'
  } catch {
    return true
  }
}

async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const m = await import('./milliDemo')
  return m.milliDemoAnswer(path, init) as Promise<T>
}
