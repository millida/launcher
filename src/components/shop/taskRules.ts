import type { DiscordReward, TelegramReward } from '../../lib/rubies'
import { isTransientApiError } from '../../lib/apiError'

/**
 * Задания магазина «Подпишись на Telegram» и «Вступи в Discord» (переделка
 * 26.10.2026: «не видно, что происходит, выполнено ли задание»). Здесь — только
 * решения без экрана: на каком шаге человек, чем кончилась проверка, что
 * показывать. Рисует их SocialTasks.tsx.
 */

export type TaskKind = 'telegram' | 'discord'
export type TaskView = TelegramReward | DiscordReward

/**
 * link      — аккаунт ещё не привязан, кнопка «Привязать»;
 * link-wait — ссылка привязки открыта, ждём возвращения человека;
 * join      — привязан, осталось подписаться/вступить;
 * check     — ссылка открыта, остаётся «Проверить».
 */
export type TaskStep = 'hidden' | 'link' | 'link-wait' | 'join' | 'check'
export type ShownStep = Exclude<TaskStep, 'hidden'>

/** Что человек уже открыл в этом запуске: по ссылке сервер этого не узнает. */
export interface TaskOpened {
  link: boolean
  join: boolean
}

/**
 * Открытые шаги переживают пересоздание окна (трей, игра): иначе шаг откатывался на «Подписаться»,
 * хотя человек уже всё открыл. Но не навсегда: через полчаса человек мог передумать и забыть.
 */
export const OPENED_TTL_MS = 30 * 60 * 1000

export type OpenedMap = Record<TaskKind, TaskOpened>

export const noneOpened = (): OpenedMap => ({ telegram: { link: false, join: false }, discord: { link: false, join: false } })

export function parseOpened(raw: string | null, now: number): OpenedMap {
  const out = noneOpened()
  try {
    const saved = JSON.parse(raw || 'null') as { at?: number; opened?: Partial<Record<TaskKind, Partial<TaskOpened>>> } | null
    if (!saved || typeof saved.at !== 'number' || now - saved.at > OPENED_TTL_MS || now < saved.at) return out
    for (const k of ['telegram', 'discord'] as const) {
      out[k] = { link: saved.opened?.[k]?.link === true, join: saved.opened?.[k]?.join === true }
    }
  } catch (e) {
    console.warn('[tasks] the saved opened links are unreadable, starting clean', e)
  }
  return out
}

export const serializeOpened = (opened: OpenedMap, now: number): string => JSON.stringify({ at: now, opened })

export function taskStep(view: TaskView | null, opened: TaskOpened): TaskStep {
  if (!view || typeof view !== 'object' || view.claimed) return 'hidden'
  if (!view.available || !(view.amount > 0)) return 'hidden'
  if (!view.linked) return opened.link ? 'link-wait' : 'link'
  return opened.join ? 'check' : 'join'
}

/** Сколько из трёх делений полосы заполнено: привязка, подписка, проверка. */
export const STEP_FILL: Record<ShownStep, number> = { link: 0, 'link-wait': 0, join: 1, check: 2 }

export const SEGMENTS = 3

/**
 * Ответ сервера на «Проверить», сведённый к трём случаям (сервер отвечает
 * текстом, а в браузере — голым «http 400»):
 *  miss  — подписки/вступления не видно (400): человек ещё не сделал;
 *  net   — Telegram/Discord/сеть не ответили (5xx, обрыв): повторить можно сразу;
 *  taken — этот аккаунт уже получил награду на другом профиле Millida (409).
 *  auth  — вход в Millida устарел (401/403): подписка тут ни при чём, нужно войти заново.
 * link — не открылась ссылка привязки (её плитка просит у сервера отдельно).
 */
export type TaskFailure = 'miss' | 'net' | 'taken' | 'link' | 'auth'

export function claimFailure(e: unknown): TaskFailure {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '')
  if (/\bhttp 409\b|уже получил/i.test(raw)) return 'taken'
  if (/\bhttp 40[13]\b|\bunauthorized\b|не авторизован|нет токена Millida/i.test(raw)) return 'auth'
  if (isTransientApiError(e) || /не ответил/i.test(raw)) return 'net'
  return 'miss'
}

/** Рубины за все ещё не полученные задания: число в шапке блока. */
export function totalReward(views: (TaskView | null)[]): number {
  let sum = 0
  for (const v of views) if (taskStep(v, { link: false, join: false }) !== 'hidden') sum += (v as TaskView).amount
  return sum
}

export function telegramLink(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 't.me' ? parsed.toString() : null
  } catch {
    return null
  }
}

/** Приглашение Discord от сервера: только https и только свои адреса. */
export function discordInvite(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (parsed.hostname === 'discord.gg' || parsed.hostname === 'discord.com') ? parsed.toString() : null
  } catch {
    return null
  }
}
