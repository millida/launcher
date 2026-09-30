/*
 * Платные материалы каталога Millida — чистая логика, без React и сети.
 *
 * Формы ответов взяты с сайта (`components/catalog/item/paid-flow.ts`,
 * `item-api.ts`, `lib/catalog-api.ts`) и бэкенда (`catalog-purchase.*`).
 * Отличие одно: в приложении запрос идёт через ядро, и отказ приходит строкой
 * сервера («Не хватает денег на балансе»), а не телом с `code` — поэтому
 * вердикт узнаётся и по коду статуса (браузер), и по тексту (приложение).
 */

export type Pricing = 'FREE' | 'ONE_TIME' | 'SUBSCRIPTION'

export type AccessState = 'unknown' | 'locked' | 'open'

/** Версия файла материала — публичная проекция `/catalog/items/:slug` → `files[]`. */
export interface CatalogFile {
  id: string
  version: string
  gameVersions: string[]
  primaryGameVersion?: string | null
  loaders: string[]
  fileName: string
  size: number
  sha1: string | null
  releasedAt: string | null
}

/** «300 ₽», «1 290,50 ₽» — как `rub` в `lib/premium.ts`, без его зависимостей. */
export function rubles(kopecks: number): string {
  const value = Math.round(kopecks || 0) / 100
  const text = Number.isInteger(value)
    ? value.toLocaleString('ru-RU')
    : value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return text + ' ₽'
}

export function isPaid(pricing: string | null | undefined, kopecks: number | null | undefined): boolean {
  return (pricing === 'ONE_TIME' || pricing === 'SUBSCRIPTION') && typeof kopecks === 'number' && kopecks > 0
}

/** Цена на строке: «300 ₽» за покупку навсегда, «300 ₽/мес» за подписку, пусто у бесплатного. */
export function priceTag(pricing: string | null | undefined, kopecks: number | null | undefined): string {
  if (!isPaid(pricing, kopecks)) return ''
  return rubles(kopecks as number) + (pricing === 'SUBSCRIPTION' ? '/мес' : '')
}

/** Подпись главной кнопки платного материала без доступа. */
export const buyLabel = (pricing: string | null | undefined): string => (pricing === 'SUBSCRIPTION' ? 'Подписаться' : 'Купить')

/* ── Ответ /catalog/items/:slug/access ── */

export function accessState(body: unknown): AccessState {
  const b = (body ?? {}) as { hasAccess?: unknown; isOwner?: unknown }
  return b.hasAccess === true || b.isOwner === true ? 'open' : 'locked'
}

/** Цена, которую сервер спишет сейчас: лента — общий кэш и может помнить старую. */
export function livePriceKopecks(body: unknown): number | null {
  const b = (body ?? {}) as { pricing?: unknown; priceKopecks?: unknown }
  const price = typeof b.priceKopecks === 'number' ? b.priceKopecks : null
  return (b.pricing === 'ONE_TIME' || b.pricing === 'SUBSCRIPTION') && price !== null && Number.isSafeInteger(price) && price > 0
    ? price
    : null
}

/** Сколько не хватает на кошельке; null — баланс неизвестен, решает сервер. */
export function shortfallKopecks(price: number, balance: number | null | undefined): number | null {
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return null
  return Math.max(0, Math.ceil(price - balance))
}

/* ── Отказы ── */

export type PaidVerdict =
  | { kind: 'login' }
  | { kind: 'funds' }
  | { kind: 'price-changed' }
  | { kind: 'no-access' }
  | { kind: 'owned' }
  | { kind: 'frozen' }
  | { kind: 'busy' }
  | { kind: 'error'; raw: string }

const RULES: [RegExp, PaidVerdict['kind']][] = [
  [/^http 401$|^unauthorized$|войдите в аккаунт|войди в аккаунт|сессия millida/i, 'login'],
  [/^http 402$|insufficient_funds|не хватает (денег|средств)/i, 'funds'],
  [/price_changed|цена изменилась/i, 'price-changed'],
  [/already_owned|доступ уже есть|это ваш материал|own_item/i, 'owned'],
  [/balance_frozen|баланс заморожен/i, 'frozen'],
  [/in_progress|покупка уже идёт/i, 'busy'],
  [/^http 403$|no_access|доступен после покупки|нет доступа|доступ истёк|доступна по подписке|подписка .*закончилась/i, 'no-access'],
]

/**
 * Отказ покупки, подписки или ссылки на файл → что показать. В приложении
 * это строка ядра («http 401» или сообщение сервера), в браузере — «http NNN».
 */
export function paidVerdict(e: unknown): PaidVerdict {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '')
    .replace(/^Error:\s*/, '')
    .replace(/^pack-access:\s*/, '')
    .trim()
  for (const [re, kind] of RULES) if (re.test(raw)) return { kind } as PaidVerdict
  return { kind: 'error', raw }
}

/** Короткая фраза для тоста; null — у вердикта свой экран (вход, пополнение). */
export function verdictText(v: PaidVerdict): string | null {
  switch (v.kind) {
    case 'login':
      return 'Войди в аккаунт Millida'
    case 'funds':
      return 'Не хватает денег на балансе'
    case 'price-changed':
      return 'Цена изменилась — проверь и подтверди'
    case 'no-access':
      return 'Сначала купи — потом установка'
    case 'owned':
      return 'Уже куплено'
    case 'frozen':
      return 'Баланс заморожен — напиши в поддержку'
    case 'busy':
      return 'Покупка уже идёт — подожди минуту'
    default:
      return null
  }
}

/* ── Выбор файла под сборку ── */

/** У ресурс-паков, дата-паков, карт и шейдеров загрузчик сборки не решает. */
const LOADERLESS = new Set(['resourcepack', 'datapack', 'world', 'shader'])

function loaderFits(file: CatalogFile, loader: string, kind: string): boolean {
  if (LOADERLESS.has(kind) || !loader || loader === 'vanilla' || !file.loaders.length) return true
  if (file.loaders.includes(loader)) return true
  // Quilt грузит моды Fabric; обратного нет.
  return loader === 'quilt' && file.loaders.includes('fabric')
}

const time = (f: CatalogFile): number => {
  const t = f.releasedAt ? Date.parse(f.releasedAt) : NaN
  return Number.isNaN(t) ? 0 : t
}

export interface FilePick {
  file: CatalogFile
  /** Файл сделан под версию и загрузчик сборки. */
  fits: boolean
  /** Под какие версии игры материал есть — для вопроса «поставить всё равно?». */
  versions: string[]
}

/**
 * Файл материала для сборки: самый свежий под её версию игры и загрузчик.
 * Не нашлось — самый свежий под загрузчик (или вообще), с `fits: false`:
 * решает игрок, как и у Modrinth-установки.
 */
export function pickFile(files: CatalogFile[] | null | undefined, build: { version: string; loader: string } | null, kind: string): FilePick | null {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.id === 'string' && f.id)
  if (!list.length) return null
  const sorted = list
    .map((f, i) => ({ f, i }))
    .sort((a, b) => time(b.f) - time(a.f) || a.i - b.i)
    .map((x) => x.f)
  const versions = [...new Set(sorted.flatMap((f) => f.gameVersions || []))].slice(0, 8)
  if (!build) return { file: sorted[0]!, fits: true, versions }
  const byLoader = sorted.filter((f) => loaderFits(f, build.loader, kind))
  const exact = byLoader.find((f) => !build.version || !(f.gameVersions || []).length || f.gameVersions.includes(build.version))
  if (exact) return { file: exact, fits: true, versions }
  return { file: byLoader[0] || sorted[0]!, fits: false, versions }
}

/* ── Покупки: /catalog/purchases/me ── */

export interface Purchase {
  id: string
  slug: string
  title: string
  /** Тип материала с бэкенда: MOD, MODPACK, TEXTURE_PACK… или BUNDLE. */
  type: string
  iconUrl: string | null
  kind: string
  status: string
  amountKopecks: number
  accessUntil: string | null
  createdAt: string | null
}

const TYPE_SECTION: Record<string, string> = {
  MOD: 'mods',
  MODPACK: 'modpacks',
  TEXTURE_PACK: 'texture-packs',
  SHADER: 'shaders',
  DATA_PACK: 'data-packs',
  MAP: 'maps',
}

/** Раздел каталога по типу покупки; null — лаунчер это не ставит (подборка, плагин). */
export const sectionOfType = (type: string): string | null => TYPE_SECTION[type] || null

/** Ответ покупок → строки: без возвратов, без подборок, одна строка на материал, свежие сверху. */
export function purchasesFrom(body: unknown, now = Date.now()): Purchase[] {
  const rows = Array.isArray(body) ? body : []
  const out: Purchase[] = []
  const seen = new Set<string>()
  for (const r of rows as Record<string, any>[]) {
    const item = r && r.item
    if (!item || typeof item.slug !== 'string' || !item.slug) continue
    if (r.status === 'REFUNDED' || r.status === 'FAILED' || r.status === 'PENDING') continue
    if (!sectionOfType(String(item.type))) continue
    const until = typeof r.accessUntil === 'string' ? r.accessUntil : null
    if (until && Date.parse(until) < now) continue
    if (seen.has(item.slug)) continue
    seen.add(item.slug)
    out.push({
      id: String(r.id || item.slug),
      slug: item.slug,
      title: String(item.title || item.slug),
      type: String(item.type),
      iconUrl: typeof item.iconUrl === 'string' ? item.iconUrl : null,
      kind: String(r.kind || 'ONE_TIME'),
      status: String(r.status || ''),
      amountKopecks: typeof r.amountKopecks === 'number' ? r.amountKopecks : 0,
      accessUntil: until,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
    })
  }
  return out
}

/** Ключ повтора покупки: один на попытку, повтор после обрыва связи идёт с ним же. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
