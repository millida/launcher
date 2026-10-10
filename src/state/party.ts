import { create } from 'zustand'
import { api, hasMillidaAccount } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { warmHeads } from '../lib/heads'
import { isRealtimeLive, onRealtime } from '../lib/realtime'
import {
  normalizePartyCode,
  type AgeBracket,
  type Party,
  type PartyHave,
  type PartyInvite,
  type PartyTarget,
} from '../lib/party'
import { showToast } from './ui'

export interface PartySafety {
  ageBracket: AgeBracket | null
  newAccount: boolean
}

interface PartyReply {
  party: Party | null
}

interface PartyLoad extends PartyReply {
  me: string
  invites: PartyInvite[]
  safety: PartySafety
}

export interface PackConfirmAsk {
  code: string
  title: string
  resolve: (ok: boolean) => void
}

export interface ReportAsk {
  userId: string
  nick: string
  context: ReportContext
  refId?: string
}

interface PartyState {
  me: string
  party: Party | null
  invites: PartyInvite[]
  safety: PartySafety
  loaded: boolean
  inviteOpen: boolean
  lfgOpen: boolean
  packAsk: PackConfirmAsk | null
  reportAsk: ReportAsk | null
  set: (patch: Partial<PartyState>) => void
}

export const usePartyStore = create<PartyState>((set) => ({
  me: '',
  party: null,
  invites: [],
  safety: { ageBracket: null, newAccount: false },
  loaded: false,
  inviteOpen: false,
  lfgOpen: false,
  packAsk: null,
  reportAsk: null,
  set: (patch) => set(patch as PartyState),
}))

const st = () => usePartyStore.getState()

/** Only the newest answer may land: a slow reply to an old request must not roll the party back. */
let loadSeq = 0

function applyParty(party: Party | null) {
  if (party) warmHeads(party.members.map((m) => m.nickname))
  st().set({ party })
}

export async function loadParty(): Promise<void> {
  if (!hasMillidaAccount()) return
  const seq = ++loadSeq
  const r = await api<PartyLoad>('/party')
  if (seq !== loadSeq) return
  st().set({
    me: r.me || '',
    invites: Array.isArray(r.invites) ? r.invites : [],
    safety: r.safety || { ageBracket: null, newAccount: false },
    loaded: true,
  })
  applyParty(r.party || null)
}

async function partyCall(path: string, body?: unknown): Promise<Party | null> {
  const seq = ++loadSeq
  const r = await api<PartyReply>('/party' + path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
  if (seq === loadSeq) applyParty(r.party ?? null)
  return r.party ?? null
}

/** Each action reports its own failure in words and returns null; success is returned, never assumed. */
async function attempt<T>(run: () => Promise<T>, fallback: string): Promise<T | null> {
  try {
    return await run()
  } catch (e) {
    showToast(apiErrorText(e, fallback), 'error')
    return null
  }
}

export const isLeader = (p: Party | null, me: string): boolean => !!p && !!me && p.leaderId === me

export const partyWithOthers = (p: Party | null): boolean => !!p && p.members.length > 1

export const createParty = () => attempt(() => partyCall(''), 'Не удалось собрать пати')

export const leaveParty = () => attempt(() => partyCall('/leave'), 'Не удалось выйти из пати')

export const kickFromParty = (userId: string) => attempt(() => partyCall('/kick', { userId }), 'Не удалось исключить')

export const promoteInParty = (userId: string) =>
  attempt(() => partyCall('/promote', { userId }), 'Не удалось передать лидерство')

export const setPartyCapacity = (capacity: number) =>
  attempt(() => partyCall('/capacity', { capacity }), 'Не удалось изменить размер пати')

export const setPartyTarget = (target: PartyTarget) =>
  attempt(() => partyCall('/target', { target }), 'Не удалось выбрать режим для пати')

export const setPartyReady = (ready: boolean, have: PartyHave | null) =>
  attempt(() => partyCall('/ready', have ? { ready, have } : { ready }), 'Не удалось отметить готовность')

export const startPartyLaunch = (addr: string | null) =>
  attempt(() => partyCall('/launch', addr ? { addr } : {}), 'Не удалось запустить пати')

export async function inviteToParty(userId: string): Promise<boolean> {
  if (!st().party && !(await createParty())) return false
  const ok = await attempt(
    () => api('/party/invite', { method: 'POST', body: JSON.stringify({ userId }) }),
    'Приглашение не ушло',
  )
  return ok !== null
}

export async function partyInviteCode(): Promise<{ code: string; url: string; expiresAt: number } | null> {
  if (!st().party && !(await createParty())) return null
  return attempt(
    () => api<{ code: string; url: string; expiresAt: number }>('/party/code', { method: 'POST', body: '{}' }),
    'Не удалось получить код',
  )
}

export const joinPartyByCode = (raw: string) =>
  attempt(() => partyCall('/join', { code: normalizePartyCode(raw) }), 'Не удалось войти в пати')

export async function acceptPartyInvite(id: string): Promise<Party | null> {
  const party = await attempt(() => partyCall('/invites/' + encodeURIComponent(id) + '/accept'), 'Не удалось войти в пати')
  st().set({ invites: st().invites.filter((i) => i.id !== id) })
  return party
}

export async function declinePartyInvite(id: string): Promise<void> {
  const ok = await attempt(
    () => api('/party/invites/' + encodeURIComponent(id) + '/decline', { method: 'POST', body: '{}' }),
    'Не удалось отклонить',
  )
  if (ok !== null) st().set({ invites: st().invites.filter((i) => i.id !== id) })
}

export async function setAgeBracket(ageBracket: AgeBracket): Promise<boolean> {
  const r = await attempt(
    () => api<{ ageBracket: AgeBracket }>('/party/safety', { method: 'POST', body: JSON.stringify({ ageBracket }) }),
    'Не удалось сохранить возраст',
  )
  if (!r) return false
  st().set({ safety: { ...st().safety, ageBracket: r.ageBracket } })
  return true
}

export type ReportReason = 'spam' | 'abuse' | 'cheating' | 'inappropriate' | 'scam' | 'other'
export type ReportContext = 'lfg' | 'party' | 'voice' | 'invite'

export async function reportPlayer(
  userId: string,
  reason: ReportReason,
  context: ReportContext,
  opts: { refId?: string; block?: boolean } = {},
): Promise<boolean> {
  const r = await attempt(
    () =>
      api('/party/report', {
        method: 'POST',
        body: JSON.stringify({ userId, reason, context, refId: opts.refId, block: !!opts.block }),
      }),
    'Жалоба не отправилась',
  )
  if (r === null) return false
  showToast(opts.block ? 'Жалоба отправлена, игрок заблокирован' : 'Жалоба отправлена')
  if (opts.block) void loadParty().catch((e) => console.error('[party] reload', e))
  return true
}

const SLOW_POLL_MS = 60_000
const PARTY_POLL_MS = 15_000

let started = false

/** Server-side party survives restarts: the launcher restores it on start and follows pushes after. */
export function initParty(onChange: () => void): () => void {
  if (started) return () => {}
  started = true
  const refresh = () =>
    void loadParty()
      .then(onChange)
      .catch((e) => console.error('[party] load', e))
  refresh()
  const off = onRealtime('party', refresh)
  let last = Date.now()
  const timer = setInterval(() => {
    const busy = !!st().party || st().invites.length > 0
    const every = isRealtimeLive() ? SLOW_POLL_MS : busy ? PARTY_POLL_MS : SLOW_POLL_MS
    if (document.hidden && !busy) return
    if (Date.now() - last < every) return
    last = Date.now()
    refresh()
  }, 5000)
  return () => {
    started = false
    off()
    clearInterval(timer)
  }
}
