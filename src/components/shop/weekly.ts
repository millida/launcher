import { api } from '../../lib/api'
import type { ItemRef, WeeklyParcel } from '../../lib/rubies'

/**
 * Недельный путь — замена «посылки недели» (правка владельца 23.09.2026:
 * «просто так давать какую-то хуйню странно; чтобы дрочили и донатили»).
 *
 * Звёзды за задания недели (часы игры, друг, новый сервер, дни входа, подарок
 * дня, примерка) ведут к одной вещи недели, которую видно заранее. По пути —
 * две ступени осколков. Не хватает немного — звёзды можно докупить рубинами,
 * но только последние 30 % пути: оплата дополняет игру, а не заменяет её.
 * PLUS: звёзды за часы ×2. Случайного нет нигде.
 *
 * Контракт — analysis/2026-09-23_economy-api-contract.md, раздел «Недельный путь».
 */
export type WeeklyReward = { kind: 'SHARDS'; amount: number } | { kind: 'ITEM'; item: ItemRef }

export interface WeeklyTask {
  code: string
  title: string
  /** Сколько звёзд даёт задание целиком (у часов — по звезде за час). */
  stars: number
  /** Сколько звёзд уже заработано этим заданием. */
  earned: number
  progress: number
  target: number
  /** Единица прогресса для подписи: «ч», «дн», «раз». */
  unit?: string
}

export interface WeeklyStep {
  at: number
  reward: WeeklyReward
  claimed: boolean
}

export interface WeeklyPath {
  weekKey: number
  resetsAt: string
  stars: number
  need: number
  /** Вещь недели: одна на всех, видна с понедельника. */
  prize: ItemRef
  /** Цена вещи в магазине — для подписи «в магазине N». */
  prizePrice: number
  steps: WeeklyStep[]
  tasks: WeeklyTask[]
  plus: boolean
  /** Множитель звёзд за часы у подписчика PLUS. */
  plusHoursBoost: number
  /** Докупить недостающие звёзды: только когда пройдено ≥ 70 % пути. */
  boost: { available: boolean; missing: number; pricePerStar: number; price: number } | null
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

/**
 * Служба на /rubies/weekly теперь отдаёт посылку недели (hours/need/choices),
 * а не путь со ступенями: без проверки формы экран магазина падал на
 * `steps.find` (1.0.115, 25.09.2026). Чужая форма — блока нет.
 */
/** Посылка недели (что служба отдаёт сейчас): часы, порог, три вещи на выбор. */
const isParcel = (d: unknown): d is WeeklyParcel => {
  const x = d as Partial<WeeklyParcel> | null
  return !!x && typeof x.hours === 'number' && typeof x.need === 'number' && x.need > 0 && typeof x.resetsAt === 'string'
    && (x.choices === null || x.choices === undefined || Array.isArray(x.choices))
}

/**
 * Один запрос /rubies/weekly — какой блок рисовать: путь со ступенями (если
 * служба когда-нибудь его отдаст) или посылку недели. Чужая форма — ничего.
 */
export type WeeklyAny = { path: WeeklyPath; parcel?: undefined } | { parcel: WeeklyParcel; path?: undefined } | null
export const loadWeeklyAny = (): Promise<WeeklyAny> =>
  api<unknown>('/rubies/weekly').then((d) => {
    const x = d as Partial<WeeklyPath> | null
    if (x && Array.isArray(x.steps) && Array.isArray(x.tasks ?? [])) return { path: d as WeeklyPath }
    if (isParcel(d)) return { parcel: { ...d, choices: Array.isArray(d.choices) ? d.choices : null } }
    return null
  })

export const loadWeeklyPath = () =>
  api<WeeklyPath>('/rubies/weekly').then((d) =>
    d && Array.isArray((d as Partial<WeeklyPath>).steps) && Array.isArray((d as Partial<WeeklyPath>).tasks ?? []) ? d : null,
  )
export const claimWeeklyStep = (at: number) =>
  api<{ path: WeeklyPath; balance: number; shards: number; granted: WeeklyReward }>('/rubies/weekly/claim', post({ at }))
export const boostWeekly = (stars: number) =>
  api<{ path: WeeklyPath; balance: number }>('/rubies/weekly/boost', post({ stars }))
