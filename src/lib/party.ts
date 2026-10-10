export type AgeBracket = 'u13' | '13_15' | '16_17' | 'adult'
export type PartyTargetKind = 'build' | 'version' | 'premium' | 'server'

export interface PartyTarget {
  kind: PartyTargetKind
  ref: string
  version: string
  title: string
  game: string
}

export interface PartyHave {
  kind: PartyTargetKind
  ref: string
  version: string
}

export interface PartyMember {
  userId: string
  nickname: string
  avatarUrl: string | null
  role: 'leader' | 'member'
  ready: boolean
  joinedAt: number
  have: PartyHave | null
}

export interface PartyVoiceMember {
  userId: string
  since: number
  muted: boolean
  screen: boolean
}

export interface PartyLaunch {
  seq: number
  at: number
  addr: string | null
  target: PartyTarget
}

export interface Party {
  id: string
  leaderId: string
  capacity: number
  maxCapacity: number
  target: PartyTarget | null
  targetRev: number
  members: PartyMember[]
  launch: PartyLaunch | null
  voice: PartyVoiceMember[]
  rev: number
}

export interface PartyInvite {
  id: string
  partyId: string
  from: { userId: string; nickname: string; avatarUrl: string | null }
  size: number
  capacity: number
  title: string | null
  expiresAt: number
}

export const DEFAULT_PARTY_CAPACITY = 4

export const AGE_BRACKETS: { id: AgeBracket; label: string }[] = [
  { id: 'u13', label: 'До 13' },
  { id: '13_15', label: '13–15' },
  { id: '16_17', label: '16–17' },
  { id: 'adult', label: '18+' },
]

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 8

export function normalizePartyCode(raw: string): string {
  const tail = (raw || '').trim().split('/').filter(Boolean).pop() || ''
  return tail
    .toUpperCase()
    .split('')
    .filter((c) => /[A-Z0-9]/.test(c))
    .join('')
}

export function partyCodeOk(raw: string): boolean {
  const code = normalizePartyCode(raw)
  return code.length === CODE_LEN && code.split('').every((c) => CODE_ALPHABET.includes(c))
}

export const prettyPartyCode = (code: string): string =>
  code.length === CODE_LEN ? code.slice(0, 4) + '-' + code.slice(4) : code

export const identityOf = (t: PartyTarget | PartyHave): PartyHave => ({ kind: t.kind, ref: t.ref, version: t.version })

export function sameIdentity(a: PartyHave | null | undefined, b: PartyHave | null | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.ref === b.ref && a.version === b.version
}

export type SlotSide = 'left' | 'right'

export interface SlotCell {
  side: SlotSide
  member: PartyMember | null
}

export interface SlotPlan {
  cells: SlotCell[]
  size: 'lg' | 'md' | 'sm'
}

/**
 * Everyone but me stands beside my character, first to the right, then to the left,
 * alternating, in join order; free seats follow as empty slots. Bigger parties shrink
 * the figures so both flanks still fit between the side panels.
 */
export function slotPlan(capacity: number, members: PartyMember[], me: string): SlotPlan {
  const seats = Math.max(1, capacity) - 1
  const others = members.filter((m) => m.userId !== me).sort((a, b) => a.joinedAt - b.joinedAt)
  const cells: SlotCell[] = []
  for (let i = 0; i < Math.max(seats, others.length); i += 1) {
    cells.push({ side: i % 2 === 0 ? 'right' : 'left', member: others[i] ?? null })
  }
  const perSide = Math.ceil(cells.length / 2)
  return { cells, size: perSide <= 2 ? 'lg' : perSide <= 3 ? 'md' : 'sm' }
}

/** A launch only starts the game on this machine while it is fresh: a restart must not replay an old one. */
export const LAUNCH_FRESH_MS = 120_000

export function launchToRun(launch: PartyLaunch | null, lastSeq: number, now: number): PartyLaunch | null {
  if (!launch || launch.seq <= lastSeq) return null
  return now - launch.at <= LAUNCH_FRESH_MS ? launch : null
}

export type LaunchBlock = { kind: 'no_target' } | { kind: 'not_ready'; nicks: string[] } | null

export function launchBlock(party: Party): LaunchBlock {
  if (!party.target) return { kind: 'no_target' }
  const target = party.target
  const waiting = party.members.filter(
    (m) => m.userId !== party.leaderId && (!m.ready || !sameIdentity(m.have, target)),
  )
  return waiting.length ? { kind: 'not_ready', nicks: waiting.map((m) => m.nickname || 'Игрок') } : null
}

export const LFG_MODES = [
  { id: 'survival', label: 'Выживание' },
  { id: 'creative', label: 'Креатив' },
  { id: 'pvp', label: 'PvP' },
  { id: 'minigames', label: 'Мини-игры' },
  { id: 'modded', label: 'С модами' },
  { id: 'anarchy', label: 'Анархия' },
  { id: 'skyblock', label: 'Скайблок' },
  { id: 'rpg', label: 'RPG' },
  { id: 'other', label: 'Другое' },
] as const

export const LFG_LANGS = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
  { id: 'uk', label: 'Українська' },
  { id: 'kk', label: 'Қазақша' },
  { id: 'by', label: 'Беларуская' },
  { id: 'other', label: 'Другой' },
] as const

export const LFG_REGIONS = [
  { id: 'eu', label: 'Европа' },
  { id: 'ru_west', label: 'Запад РФ' },
  { id: 'ru_east', label: 'Восток РФ' },
  { id: 'asia', label: 'Азия' },
  { id: 'na', label: 'Америка' },
  { id: 'other', label: 'Другой' },
] as const

export const LFG_TIMES = [
  { id: 'now', label: 'Сейчас' },
  { id: 'evening', label: 'Вечером' },
  { id: 'weekend', label: 'В выходные' },
] as const

export interface LfgTags {
  mode: (typeof LFG_MODES)[number]['id']
  version: string
  pack: string
  lang: (typeof LFG_LANGS)[number]['id']
  region: (typeof LFG_REGIONS)[number]['id']
  voice: boolean
  time: (typeof LFG_TIMES)[number]['id']
}

export interface LfgCard {
  id: string
  user: { userId: string; nickname: string; avatarUrl: string | null }
  tags: LfgTags
  size: number
  capacity: number
  createdAt: number
  expiresAt: number
  requested: boolean
}

const labelOf = (list: readonly { id: string; label: string }[], id: string): string =>
  list.find((x) => x.id === id)?.label || ''

/** A card is read as a row of tags only: nothing a stranger typed is ever shown. */
export function lfgTagLabels(t: LfgTags): string[] {
  return [
    labelOf(LFG_MODES, t.mode),
    t.version,
    t.pack,
    labelOf(LFG_LANGS, t.lang),
    labelOf(LFG_REGIONS, t.region),
    t.voice ? 'С голосом' : 'Без голоса',
    labelOf(LFG_TIMES, t.time),
  ].filter(Boolean)
}

const PACK_TAG_RE = /^[a-z0-9._-]{0,64}$/
const VERSION_TAG_RE = /^(\d{1,4}(\.\d{1,3}){1,2})?$/

export function lfgTagsOk(t: LfgTags): boolean {
  return (
    LFG_MODES.some((x) => x.id === t.mode) &&
    LFG_LANGS.some((x) => x.id === t.lang) &&
    LFG_REGIONS.some((x) => x.id === t.region) &&
    LFG_TIMES.some((x) => x.id === t.time) &&
    VERSION_TAG_RE.test(t.version) &&
    PACK_TAG_RE.test(t.pack) &&
    typeof t.voice === 'boolean'
  )
}
