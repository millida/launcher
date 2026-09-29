import { api } from './api'

export type InviteFriendStatus = 'pending' | 'qualified' | 'rejected'
export type InviteWait = 'play' | 'email' | 'queue' | null

export interface InviteTier {
  friends: number
  plusDays: number
  chest: string | null
  chestName: string | null
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

export interface InviteOverview {
  code: string
  link: string
  deepLink: string
  qualified: number
  pending: number
  perFriendPlusDays: number
  rules: { playSeconds: number; dailyLimit: number }
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

const PENDING_CODE_KEY = 'm-invite-code'

export function normalizeInviteCode(raw: string): string {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
}

export function rememberInviteCode(raw: string): void {
  const code = normalizeInviteCode(raw)
  if (!code) return
  try {
    sessionStorage.setItem(PENDING_CODE_KEY, code)
  } catch {}
}

export function takeInviteCode(): string {
  try {
    const code = sessionStorage.getItem(PENDING_CODE_KEY) || ''
    sessionStorage.removeItem(PENDING_CODE_KEY)
    return normalizeInviteCode(code)
  } catch {
    return ''
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

export function tierRewardText(t: Pick<InviteTier, 'plusDays' | 'chestName'>): string {
  const parts: string[] = []
  if (t.chestName) parts.push(t.chestName)
  if (t.plusDays > 0) parts.push(daysText(t.plusDays) + ' PLUS')
  return parts.join(' + ')
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
