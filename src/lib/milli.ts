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

// ─── Верстак: контракт SPEC §1 (синхронно с milli-server/src/types.ts) ────

export type MilliTab = 'mods' | 'resourcepacks' | 'shaders' | 'config'
export type MilliCat = 'perf' | 'ui' | 'world' | 'mobs' | 'tech' | 'magic' | 'adventure' | 'build' | 'look' | 'misc' | 'lib'
export type MilliBy = 'milli' | 'user' | 'auto' | 'base'
export type MilliLevel = 'off' | 'light' | 'medium' | 'heavy'
export type MilliProfile = 'low' | 'balanced' | 'high'
export type MilliRpStyle = 'fantasy' | 'medieval' | 'faithful' | 'cartoon' | 'realistic' | 'dark' | 'pvp'
/** Имена как в milli-server/src/types.ts. */
export type ShaderLevel = MilliLevel
export type PcProfile = MilliProfile
export type RpStyle = MilliRpStyle
export type ProgressKey = MilliProgressKey
/** В списках url не приходит: строим сами. */
export const milliItemUrl = (m: Pick<MilliItem, 'slug' | 'url'>, tab: MilliTab = 'mods') =>
  m.url || 'https://modrinth.com/' + (tab === 'shaders' ? 'shader' : tab === 'resourcepacks' ? 'resourcepack' : 'mod') + '/' + m.slug

export const MILLI_TABS: readonly MilliTab[] = ['mods', 'resourcepacks', 'shaders', 'config']
export const MILLI_TAB_RU: Record<MilliTab, string> = { mods: 'Моды', resourcepacks: 'Ресурс-паки', shaders: 'Шейдеры', config: 'Настройки' }
export const MILLI_CAT_RU: Record<MilliCat, string> = {
  perf: 'Оптимизация',
  ui: 'Интерфейс и удобство',
  world: 'Мир и генерация',
  mobs: 'Мобы и существа',
  tech: 'Техника',
  magic: 'Магия',
  adventure: 'Приключения и бой',
  build: 'Строительство и декор',
  look: 'Графика и звук',
  misc: 'Разное',
  lib: 'Библиотеки',
}

export interface MilliConfig {
  profile: MilliProfile
  ramMb: number
  jvm: 'g1' | 'zgc'
  /** Только белый список ванильных ключей options.txt. */
  options: Record<string, string>
  shaderPack: string | null
}

export interface MilliChangeRef {
  projectId: string
  title: string
  tab: MilliTab
  by: MilliBy
}

export interface MilliChangeset {
  titleRu: string
  by: 'milli' | 'user'
  added: MilliChangeRef[]
  removed: MilliChangeRef[]
  changed: { projectId: string; title: string; field: string; from: string; to: string }[]
  config?: { key: string; from: string; to: string }[]
  skipped?: { what: string; reasonRu: string }[]
}

export type MilliOp =
  | { op: 'add'; tab: MilliTab; ref: string }
  | { op: 'remove'; tab: MilliTab; ref: string }
  | { op: 'restore'; tab: MilliTab; ref: string }
  | { op: 'replace'; tab: MilliTab; ref: string; to: string }
  | { op: 'pin'; ref: string; on: boolean }
  | { op: 'shader_level'; level: MilliLevel }
  | { op: 'rp_style'; style: MilliRpStyle; mode: 'add' | 'replace' }
  | { op: 'profile'; profile: MilliProfile }
  | { op: 'config'; key: string; value: string }
  | { op: 'size'; target: number }
  /** Порядок ресурс-паков: первый перекрывает остальные. */
  | { op: 'order'; tab: 'resourcepacks'; refs: string[] }
  | { op: 'theme'; id: string; delta: number }

export type MilliProgressKey = 'plan' | 'candidates' | 'select' | 'resolve' | 'deps' | 'conflicts' | 'extras' | 'enrich' | 'done'

export interface MilliProgressEvent {
  seq: number
  key: MilliProgressKey
  labelRu: string
  done: number
  total: number
  sample?: string[]
  /** Сколько кандидатов найдено / версий проверено к этому моменту. */
  found?: number
  checked?: number
}

export interface MilliProgress {
  running: boolean
  events: MilliProgressEvent[]
}

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
  /** Тариф целиком (стенд присылает; прод — пока только plus). */
  tier?: 'free' | 'plus' | 'diamond' | 'qa'
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
  /** Для карточки при наведении. Прод может не прислать — читать осторожно. */
  author?: string
  /** Описание проекта Modrinth, до 140 символов. */
  description?: string
  downloads?: number
  /** https://modrinth.com/<type>/<slug> */
  url?: string
  /** Короткое описание по-русски (≤90 символов). */
  descriptionRu?: string
  /** projectId из этой сборки, которые нужны этому предмету. */
  requires?: string[]
  /** projectId из этой сборки, которым нужен этот предмет. */
  requiredBy?: string[]
  /** Точная версия Modrinth: ставится она, а не последняя (проверенная или починенная). */
  versionId?: string
  /** Имя файла (активный шейдер — для iris.properties). */
  fileName?: string
  /** Номер версии для моддеров: «0.5.13+mc1.20.1». */
  version?: string
  /** proven — эта версия уже доходила до меню; risky — есть известная проблема (см. riskNote). */
  risk?: 'proven' | 'risky'
  /** По-русски: «Версия 1.5.0 вылетает вместе с Sodium — взяли 1.4.2». */
  riskNote?: string
  cat?: MilliCat
  side?: 'client' | 'server' | 'both' | 'single'
  /** Кто положил в сборку: Милли, игрок, автоматически (зависимость), база загрузчика. */
  by?: MilliBy
  pinned?: boolean
  heavy?: boolean
  ruInGame?: boolean
  /** Шейдеры: уровень нагрузки и флаг Distant Horizons. */
  level?: 'light' | 'medium' | 'heavy'
  dh?: boolean
  /** Версию не удалось проверить (сеть) — не «нет версии». */
  unchecked?: boolean
  /** Картинка-превью (ресурс-паки, шейдеры). */
  preview?: string
  /** Разрешение ресурс-пака: «16x», «32x». */
  res?: string
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
  /** Простыми словами: какая версия или зависимость помешала. */
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
  /** true — сборка с этим составом дошла до главного меню («Проверено запуском»), false — упала. Нет поля — не проверялась. */
  verified?: boolean
  /** Необязательные зависимости выбранных модов: предложить, по умолчанию не ставить. */
  optional?: MilliItem[]
  /** Оценка по графу совместимости (сколько версий уже запускались, есть ли известные проблемы). */
  compat?: { proven: number; unknown: number; risky: number; risk: 'low' | 'medium' | 'high'; queued: boolean }
  /** Сборка упала при проверке, Милли собрала исправленную: её buildId и что сделано. */
  repair?: { buildId: string; note: string }
  /** Ревизии: buildId первой ревизии, номер, родитель. */
  chain?: string
  rev?: number
  parent?: string | null
  /** Целевой размер сборки. */
  size?: number
  shaderLevel?: MilliLevel
  config?: MilliConfig
  /** Дифф к родительской ревизии. */
  changes?: MilliChangeset | null
  /** projectId, убранные игроком: агент не возвращает без прямой просьбы. */
  userRemoved?: string[]
  themes?: { id: string; ru: string; w: number }[]
  /** Курируемая лестница шейдеров под эту версию (≤12). */
  shaderChoices?: MilliItem[]
  rpStyles?: { id: string; ru: string }[]
  /** В истории: только шапка и counts; полный — GET /packs/:buildId. */
  stub?: boolean
  counts?: { mods: number; resourcepacks: number; shaders: number }
  /** Графика под ПК игрока — строками («Дальность прорисовки — 12»). */
  setup?: MilliSetup
  /** Проверка сборки по пунктам (версии, зависимости, конфликты…). */
  check?: MilliCheck
}

export interface MilliCheck {
  ok: boolean
  issues: number
  items: { key: string; ru: string; ok: boolean; note?: string }[]
}

export interface MilliSetup {
  profile: MilliProfile
  lines: { key: string; ru: string; value: string }[]
}

/** Железо игрока (POST /messages pc). */
export interface MilliPc {
  ramMb: number
  cores?: number
  gpu?: string
}

/** Вопрос сервера о размере новой сборки (без модели, попытка не списана). */
export const MILLI_SIZE_ASK = 'Сколько модов взять?'
export const isMilliSizeAsk = (m: Pick<MilliMessage, 'role' | 'text' | 'pack' | 'ask'>) =>
  m.role === 'assistant' && !m.pack && (m.ask === 'size' || m.text.startsWith(MILLI_SIZE_ASK))

export interface MilliReview {
  added: { title: string }[]
  removed: { title: string; reason: string }[]
}

export interface MilliLooks {
  kind: 'rp' | 'shader'
  key: string
  label: string
  items: MilliItem[]
}

export interface MilliMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  pack: MilliPack | null
  suggestions: string[]
  /** 'size' — Милли спрашивает, сколько модов взять (без модели, попытка не списана). */
  ask?: 'size'
  /** План сборки до сборки: «Принять / Дополнить / Изменить» (council/CHAT-AGENT.md). */
  plan?: MilliPlanCard
  /** Действие на ПК игрока: карточка «было → станет» (lib/milliActions.ts, parseAction). */
  action?: unknown
  /** Варианты ресурс-паков / шейдеров на выбор (жмёшь — встают в сборку). */
  looks?: MilliLooks
}

export interface MilliPlanCard {
  title: string
  /** RU-ярлыки тем, ≤5. */
  themes: string[]
  /** RU: чего не будет. */
  avoid: string[]
  size: number
  /** null — сервер выберет («авто»). */
  mc: string | null
  loader: string | null
  /** Ключевые моды, ≤6: якоря игрока + флагманы тем. */
  mods: { title: string; icon: string | null; projectId?: string; slug?: string }[]
  shaders?: string | null
  rp?: string | null
  /** Версия и загрузчик, которые возьмёт сборщик (когда mc/loader — null). */
  mcPick?: string | null
  loaderPick?: string | null
  /** Сколько чего будет по вкладкам. */
  counts?: { mods: number; rp: number; shaders: number }
  /** Непрозрачно для клиента: сервер собирает по нему. */
  spec?: unknown
}

export interface MilliSessionHead {
  id: string
  title: string
  updatedAt: string
}

export interface MilliSession extends MilliSessionHead {
  messages: MilliMessage[]
  /** buildId текущей ревизии сборки этого чата. */
  head?: string
}

/** Кнопка приветствия: `text` уходит Милли, `sessionId` — сначала открыть этот разговор. */
export interface MilliGreetingChip {
  label: string
  text?: string
  sessionId?: string
}

/** GET /catalog/milli/greeting — первая реплика пустого чата по памяти игрока (без модели, без списания). */
export interface MilliGreeting {
  text: string
  suggestions: string[]
  chips?: MilliGreetingChip[]
  known?: boolean
}

/** Ответ сервера → приветствие или null (старый сервер, демо, битый ответ). */
export function milliGreetingOf(raw: unknown): MilliGreeting | null {
  const r = raw as Partial<MilliGreeting> | null
  if (!r || typeof r.text !== 'string' || !r.text.trim()) return null
  const str = (x: unknown): x is string => typeof x === 'string' && !!x.trim()
  const suggestions = (Array.isArray(r.suggestions) ? r.suggestions.filter(str) : []).slice(0, 4)
  const chips = (Array.isArray(r.chips) ? r.chips : [])
    .filter((c): c is MilliGreetingChip => !!c && str((c as MilliGreetingChip).label))
    .map((c) => ({ label: c.label, ...(str(c.text) ? { text: c.text } : {}), ...(str(c.sessionId) ? { sessionId: c.sessionId } : {}) }))
    .slice(0, 4)
  return { text: r.text.trim().slice(0, 200), suggestions, ...(chips.length ? { chips } : {}), ...(typeof r.known === 'boolean' ? { known: r.known } : {}) }
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
  diamond: MilliPlanLimits
}

/**
 * Тарифная сетка (владелец 05.10.2026) — пока не пришёл ответ `/catalog/milli/limits` или если он упал.
 * Считаются сообщения, где Милли думает; кнопки, «Принять», «Взять» — бесплатно.
 */
export const MILLI_PLANS: MilliPlans = { free: { day: 10, month: 40 }, plus: { day: 100, month: 600 }, diamond: { day: 200, month: 1500 } }

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
  return { free: plan(r.free, MILLI_PLANS.free), plus: plan(r.plus, MILLI_PLANS.plus), diamond: plan(r.diamond, MILLI_PLANS.diamond) }
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

/** Оформление чата по тарифу: без PLUS — зелёное, PLUS — золото, Diamond — алмаз. */
export type MilliLook = 'free' | 'plus' | 'diamond'
export function milliLook(s: Pick<MilliStatus, 'plus' | 'tier'> | null): MilliLook {
  if (!s) return 'free'
  if (s.tier === 'diamond') return 'diamond'
  return s.plus ? 'plus' : 'free'
}

/** Цифры для «×10 с PLUS»: из /limits, но без бреда вроде «×1000» от старого ответа сервера. */
export function milliPlanNumbers(p: MilliPlans): { free: number; plus: number; diamond: number; x: number } {
  const sane = p.free.day > 0 && p.plus.day > p.free.day && p.plus.day / p.free.day <= 50
  const q = sane ? p : MILLI_PLANS
  const diamond = q.diamond && q.diamond.day >= q.plus.day ? q.diamond.day : MILLI_PLANS.diamond.day
  return { free: q.free.day, plus: q.plus.day, diamond, x: Math.round(q.plus.day / q.free.day) }
}

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

/** Точная версия, если сервер её выбрал (проверенная запуском или починенная), иначе ядро берёт последнюю. */
export const milliItems = (list: MilliItem[]): PlanItem[] =>
  list.map((m) => ({ source: 'modrinth', project_id: m.projectId, ...(m.versionId ? { version_id: m.versionId } : {}) }))

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

/** «Спросить ИИ» в окне вылета: что знает ядро и моды сборки (файл и название). */
export interface CrashAskBody {
  reason: string
  cause?: string
  kind?: string
  tail?: string
  mcVersion?: string
  loader?: string
  mods: { file: string; title?: string }[]
}

export interface CrashAiAnswer {
  explain: string
  steps: string[]
  /** Только файлы из присланного списка: сервер чужих имён не возвращает. */
  disable: { file: string; title?: string }[]
  remaining: number
}

// ─── Запросы ─────────────────────────────────────────────────────────────

/**
 * В приложении — `api()` через ядро с токеном. В dev-браузере без ядра —
 * свой fetch, чтобы `code` и `scope` из тела ошибки дошли до разбора.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Тестовая Милли (milli-server) через прокси Vite: только dev и только с VITE_MILLI_TEST=1 в .env.local.
  if (import.meta.env.DEV && import.meta.env.VITE_MILLI_TEST === '1') {
    const tier = milliPreviewTier()
    return devFetch<T>('/milli-test' + path, init, { 'Content-Type': 'application/json', ...(tier ? { 'x-milli-tier': tier } : {}) })
  }
  if (import.meta.env.DEV && DEMO_USER && demoOn()) return demoRequest<T>(path, init)
  if (hasTauri() || !import.meta.env.DEV) return api<T>(path, init)
  return devFetch<T>(LAUNCHER_API + path, init, apiHeaders())
}

/**
 * Стенд: «смотреть как без PLUS / PLUS / Diamond» (меню Милли, только dev с тестовым сервером).
 * Сервер берёт тариф из заголовка x-milli-tier и ведёт для него свой счётчик.
 */
export type MilliPreviewTier = 'free' | 'plus' | 'diamond'
const PREVIEW_KEY = 'milli-preview-tier'
export function milliPreviewTier(): MilliPreviewTier | null {
  try {
    const v = localStorage.getItem(PREVIEW_KEY)
    return v === 'free' || v === 'plus' || v === 'diamond' ? v : null
  } catch {
    return null
  }
}
export function setMilliPreviewTier(t: MilliPreviewTier | null) {
  try {
    if (t) localStorage.setItem(PREVIEW_KEY, t)
    else localStorage.removeItem(PREVIEW_KEY)
  } catch {}
}
export const milliPreviewOn = () => import.meta.env.DEV && import.meta.env.VITE_MILLI_TEST === '1'

/** fetch в dev с разбором `code` и `scope` из тела ошибки — как ждёт milliError(). */
async function devFetch<T>(url: string, init: RequestInit | undefined, headers: HeadersInit): Promise<T> {
  const r = await fetch(url, { ...init, headers })
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
/** Приветствие пустого чата; null — показать запасное «Привет! Какую сборку соберём?». */
export const milliGreeting = async (playerId?: string | null): Promise<MilliGreeting | null> =>
  milliGreetingOf(await request<unknown>('/catalog/milli/greeting' + (playerId ? '?playerId=' + encodeURIComponent(playerId) : '')))
export const milliLimits = async (): Promise<MilliPlans> => milliPlans(await request<unknown>('/catalog/milli/limits'))
export const milliSessions = () => request<{ items: MilliSessionHead[] }>('/catalog/milli/sessions')
export const milliSession = (id: string) => request<MilliSession>('/catalog/milli/sessions/' + encodeURIComponent(id))
export interface MilliSendExtra {
  /** Ревизия, которую видит игрок (после кликов и отмены она новее пакета последнего сообщения). */
  buildId?: string | null
  /** Размер сборки: выбор игрока (чип или запомненный). */
  size?: number | null
  /** size взят из запомненного выбора, а не из чипа этого хода. */
  sizeSaved?: boolean
  /** Железо игрока — только в приложении. */
  pc?: MilliPc | null
  /** Факты о выбранной сборке на ПК (milliLocal.gatherFacts) — графика, бэкапы, доктор. */
  local?: unknown
}

export const milliSend = (text: string, sessionId?: string | null, enhanced = false, extra: MilliSendExtra = {}) =>
  request<MilliReply>(
    '/catalog/milli/messages',
    post({
      ...(sessionId ? { sessionId } : {}),
      text: text.slice(0, MILLI_TEXT_MAX),
      client: 'launcher',
      ...(enhanced ? { enhanced: true } : {}),
      ...(extra.buildId ? { buildId: extra.buildId } : {}),
      ...(extra.size && extra.size > 0 ? { size: Math.round(extra.size), ...(extra.sizeSaved ? { sizeSaved: true } : {}) } : {}),
      ...(extra.pc && extra.pc.ramMb > 0 ? { pc: extra.pc } : {}),
      ...(extra.local ? { local: extra.local } : {}),
    }),
  )

let pcCache: Promise<MilliPc | null> | null = null

/** Железо ПК из ядра (один раз за запуск). Без Tauri — null: в браузере не шлём. */
export function milliPc(): Promise<MilliPc | null> {
  if (!hasTauri()) return Promise.resolve(null)
  pcCache ??= Promise.all([import('../ipc/commands'), import('../components/milli/bench/detectGpu')])
    .then(async ([c, g]) => {
      const d = await c.deviceSpecs()
      if (!d || !(d.ram_mb > 0)) return null
      let gpu = ''
      try {
        gpu = g.detectGpu()
      } catch {}
      return { ramMb: d.ram_mb, ...(d.cpu_threads || d.cpu_cores ? { cores: d.cpu_threads || d.cpu_cores } : {}), ...(gpu ? { gpu: gpu.slice(0, 160) } : {}) }
    })
    .catch(() => {
      pcCache = null
      return null
    })
  return pcCache
}
export const milliInstall = (buildId: string, body: ReturnType<typeof milliInstallBody>) =>
  request<MilliInstallAnswer>('/catalog/milli/packs/' + encodeURIComponent(buildId) + '/install', post(body))
export const milliToServer = (buildId: string, serverId: string, projectIds: string[]) =>
  request<MilliServerAnswer>('/catalog/milli/packs/' + encodeURIComponent(buildId) + '/server', post({ serverId, projectIds }))
/** Сборка по buildId — например, исправленная из `pack.repair.buildId`. */
export const milliPackById = (buildId: string) => request<MilliPack>('/catalog/milli/packs/' + encodeURIComponent(buildId))
const packPath = (buildId: string) => '/catalog/milli/packs/' + encodeURIComponent(buildId)
/** Варианты ресурс-паков (по стилю) или шейдеров (по уровню) на выбор — сборка не меняется. */
export const milliLooks = (buildId: string, kind: 'rp' | 'shader', key: string) =>
  request<{ kind: string; key: string; items: MilliItem[] }>(packPath(buildId) + '/looks', post({ kind, key }))
/** Клики верстака: новая ревизия, 0 LLM, попытка не списывается. */
export const milliOps = (buildId: string, ops: MilliOp[]) => request<MilliPack>(packPath(buildId) + '/ops', post({ ops }))
/**
 * «Отменить»: шаг назад по стеку отмены сервера (повтор идёт дальше назад),
 * новая ревизия. `to` — «Вернуть» (redo): ревизия той же цепочки. Отменять нечего — 409 milli_rev.
 */
export const milliRevert = (buildId: string, to?: string) => request<MilliPack>(packPath(buildId) + '/revert', post(to ? { to } : {}))
/** Этапы идущего хода; long-poll ≤1,5 с. */
export const milliProgress = (sessionId: string, after = 0) =>
  request<MilliProgress>('/catalog/milli/progress?sessionId=' + encodeURIComponent(sessionId) + '&after=' + after)
/** Прямой адрес .mrpack (application/zip). */
export const milliMrpackUrl = (buildId: string) => {
  const path = packPath(buildId) + '/mrpack'
  if (import.meta.env.DEV && import.meta.env.VITE_MILLI_TEST === '1') return '/milli-test' + path
  return LAUNCHER_API + path
}
export const milliCrash = (body: CrashAskBody) => request<CrashAiAnswer>('/catalog/milli/crash', post(body))
/** «Стоп»: идущий ход не сохранится, только что сохранённый (≤2 мин) удалится, попытка вернётся. Старый API — 404, это не ошибка. */
export const milliCancel = (sessionId?: string | null) =>
  request<{ ok: boolean; cancelled: 'running' | 'saved' | null }>('/catalog/milli/messages/cancel', post(sessionId ? { sessionId } : {}))

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

// ─── Сводка сборки (футер карточки, «Скопировать список», .mrpack) ─────────

const pluralRu = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «212 модов» */
export const milliModsLabel = (n: number) => n + ' ' + pluralRu(n, 'мод', 'мода', 'модов')

/** Оценка веса: средние файлы Modrinth (мод ~5 МБ, РП ~25 МБ, шейдер ~2 МБ). */
export const milliSizeMb = (p: Pick<MilliPack, 'mods' | 'resourcepacks' | 'shaders'>) => p.mods.length * 5 + p.resourcepacks.length * 25 + p.shaders.length * 2

/** «~120 МБ», «~1,5 ГБ» */
export const milliSizeText = (mb: number) =>
  mb < 1000 ? '~' + Math.max(10, Math.round(mb / 10) * 10) + ' МБ' : '~' + (mb / 1024).toFixed(1).replace('.', ',') + ' ГБ'

/** «ОЗУ 6 ГБ» */
export const milliRamText = (mb: number) => 'ОЗУ ' + (Math.round((mb / 1024) * 2) / 2).toString().replace('.', ',') + ' ГБ'

/** «Скопировать список»: игроку — названия, моддеру — с версиями и ссылками. */
export function milliPackList(p: MilliPack, modder: boolean): string {
  const tabs: [ 'mods' | 'resourcepacks' | 'shaders', string][] = [
    ['mods', 'Моды'],
    ['resourcepacks', 'Ресурс-паки'],
    ['shaders', 'Шейдеры'],
  ]
  const lines = [p.title + ' · ' + p.mcVersion + ' ' + (LOADER_LABEL[p.loader] || p.loader), '']
  for (const [tab, ru] of tabs) {
    const list = p[tab] ?? []
    if (!list.length) continue
    lines.push(ru + ' (' + list.length + '):')
    for (const m of list) lines.push(modder ? '- ' + m.title + (m.version ? ' ' + m.version : '') + ' — ' + milliItemUrl(m, tab) : '- ' + m.title)
    lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}

/** «Скачать .mrpack»: адрес без входа; в приложении — внешний браузер, в dev — файл. */
export async function milliDownloadMrpack(p: Pick<MilliPack, 'buildId' | 'title'>, openExternal: (url: string) => void): Promise<boolean> {
  const url = milliMrpackUrl(p.buildId)
  if (hasTauri()) {
    openExternal(url)
    return true
  }
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error('http ' + r.status)
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (p.title || 'milli').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.mrpack'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4_000)
    return true
  } catch {
    return false
  }
}
