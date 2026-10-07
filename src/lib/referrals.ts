import { api } from './api'

export type InviteFriendStatus = 'pending' | 'qualified' | 'rejected'
export type InviteWait = 'play' | 'email' | 'queue' | null
export type PerkKind = 'badge' | 'frame' | 'title' | 'icon'

export interface InvitePerk {
  id: string
  kind: PerkKind
  name: string
}

export interface InviteTier {
  friends: number
  plusDays: number
  chest: string | null
  chestName: string | null
  perks: InvitePerk[]
  /** Выдаётся через 72 часа после N-го друга. */
  delayed: boolean
  reached: boolean
  granted: boolean
}

export interface InviteFriend {
  nickname: string | null
  status: InviteFriendStatus
  wait: InviteWait
  playSeconds: number
  invitedAt: string
  qualifiedAt: string | null
}

export interface InviteeGifts {
  badge: InvitePerk | null
  rubies: number
  chest: { tier: string; granted: boolean; playSeconds: number; needSeconds: number }
  plus: { days: number; granted: boolean }
}

export interface InviteOverview {
  code: string
  link: string
  deepLink: string
  qualified: number
  pending: number
  perFriendPlusDays: number
  rules: { playSeconds: number; playDays: number; dailyLimit: number; accountCap: number }
  /** Открытые награды-косметика. */
  perks: InvitePerk[]
  /** Что получил ты сам как приглашённый; null — тебя никто не звал. */
  invitee: InviteeGifts | null
  earned: { plusDays: number; chests: number }
  tiers: InviteTier[]
  next: { friends: number; left: number } | null
  friends: InviteFriend[]
  invitedBy: { nickname: string | null; status: InviteFriendStatus } | null
  canApply: boolean
}

export const loadInvites = () => api<InviteOverview>('/launcher/referrals/me')

export const applyInviteCode = (code: string) =>
  api<InviteOverview>('/launcher/referrals/apply', { method: 'POST', body: JSON.stringify({ code }) })

export const onboardingInvite = (query: string) =>
  api<InviteOverview>('/launcher/referrals/onboarding', { method: 'POST', body: JSON.stringify({ code: query }) })

export const lookupInviter = (query: string) =>
  api<{ found: boolean; nickname: string | null }>('/launcher/referrals/lookup', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })

const PENDING_CODE_KEY = 'm-invite-code'

export function normalizeInviteCode(raw: string): string {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
}

/// Код из ссылки живёт до первого входа и первого вопроса в онбординге, поэтому
/// лежит в localStorage: сессионное хранилище не переживает перезапуск после установки.
export function rememberInviteCode(raw: string): void {
  const code = normalizeInviteCode(raw)
  if (!code) return
  try {
    localStorage.setItem(PENDING_CODE_KEY, code)
  } catch {}
}

export function peekInviteCode(): string {
  try {
    return normalizeInviteCode(localStorage.getItem(PENDING_CODE_KEY) || '')
  } catch {
    return ''
  }
}

export function dropInviteCode(): void {
  try {
    localStorage.removeItem(PENDING_CODE_KEY)
  } catch {}
}

export function takeInviteCode(): string {
  const code = peekInviteCode()
  dropInviteCode()
  return code
}

/// Страница входа на сайте принимает `ref`: регистрация новичка по ссылке друга
/// закрепит его за пригласившим без ручного ввода.
export function withInviteRef(url: string): string {
  const code = peekInviteCode()
  if (!code) return url
  try {
    const u = new URL(url)
    if (!u.searchParams.has('ref')) u.searchParams.set('ref', code)
    return u.toString()
  } catch {
    return url
  }
}

const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const daysText = (n: number) => n + ' ' + plural(n, 'день', 'дня', 'дней')
export const friendsText = (n: number) => n + ' ' + plural(n, 'друг', 'друга', 'друзей')

/** Награды ступени по одной: «Иконка «Аметист»», «Эпический сундук», «14 дней PLUS». */
export function tierRewardParts(t: Pick<InviteTier, 'plusDays' | 'chestName'> & { perks?: InvitePerk[] }): string[] {
  const parts: string[] = []
  for (const p of t.perks ?? []) parts.push(p.kind === 'icon' ? 'Иконка «' + p.name + '»' : p.name)
  if (t.chestName) parts.push(t.chestName)
  if (t.plusDays > 0) parts.push(daysText(t.plusDays) + ' PLUS')
  return parts
}

export function tierRewardText(t: Pick<InviteTier, 'plusDays' | 'chestName'> & { perks?: InvitePerk[] }): string {
  return tierRewardParts(t).join(' + ')
}

export function tierProgress(qualified: number, tiers: Pick<InviteTier, 'friends'>[]): number {
  const next = tiers.find((t) => t.friends > qualified)
  if (!next) return 1
  const prev = [...tiers].reverse().find((t) => t.friends <= qualified)?.friends ?? 0
  return Math.max(0, Math.min(1, (qualified - prev) / (next.friends - prev)))
}

const clock = (seconds: number) => {
  const m = Math.floor(Math.max(0, seconds) / 60)
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0')
}

export function friendStatusText(f: Pick<InviteFriend, 'status' | 'wait' | 'playSeconds'>, needSeconds: number): string {
  if (f.status === 'qualified') return 'Засчитан'
  if (f.status === 'rejected') return 'Не засчитан'
  if (f.wait === 'email') return 'Ждёт подтверждения почты'
  if (f.wait === 'queue') return 'Засчитаем в ближайшие сутки'
  return 'Играет ' + clock(f.playSeconds) + ' из ' + clock(needSeconds)
}
