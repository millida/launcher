export const DUO_EMOTE_CODES = [
  'DUO_HIGH_FIVE',
  'DUO_HUG',
  'DUO_FIST_BUMP',
  'DUO_HANDSHAKE',
  'DUO_BOW',
  'DUO_SELFIE',
  'DUO_DANCE',
  'DUO_WALTZ',
  'DUO_TWIRL',
  'DUO_SWORD_DUEL',
] as const

const KNOWN: ReadonlySet<string> = new Set(DUO_EMOTE_CODES)

export const isDuoEmote = (code: string | null | undefined): boolean => !!code && KNOWN.has(code)

export type DuoInvites = 'all' | 'friends' | 'none'

export const DUO_INVITES_DEFAULT: DuoInvites = 'all'

export const DUO_INVITE_OPTIONS: [DuoInvites, string][] = [
  ['all', 'Все'],
  ['friends', 'Друзья'],
  ['none', 'Никто'],
]

export const isDuoInvites = (value: unknown): value is DuoInvites =>
  value === 'all' || value === 'friends' || value === 'none'

/**
 * Where the two figures stand, copied from the mod's emotes/duo.json
 * ("millida_scenes"): distance in blocks from A to B, turns in degrees added
 * to facing each other, and B's extra spin between two moments of the clip.
 */
export interface DuoScene {
  clip: string
  distance: number
  turnA: number
  turnB: number
  spinB: number
  spinFrom: number
  spinTo: number
}

const still = (clip: string, distance: number, turnA = 0, turnB = 0): DuoScene => ({
  clip,
  distance,
  turnA,
  turnB,
  spinB: 0,
  spinFrom: 0,
  spinTo: 0,
})

export const DUO_SCENES: Readonly<Record<(typeof DUO_EMOTE_CODES)[number], DuoScene>> = {
  DUO_HIGH_FIVE: still('high_five', 1.0),
  DUO_HUG: still('hug', 0.65),
  DUO_FIST_BUMP: still('fist_bump', 0.95),
  DUO_HANDSHAKE: still('handshake', 0.85),
  DUO_BOW: still('bow', 1.5),
  DUO_SELFIE: still('selfie', 0.7, -90, 90),
  DUO_DANCE: still('dance', 1.1),
  DUO_WALTZ: still('waltz', 0.6),
  DUO_TWIRL: { clip: 'twirl', distance: 0.7, turnA: 0, turnB: 0, spinB: 720, spinFrom: 0.5, spinTo: 2.5 },
  DUO_SWORD_DUEL: still('sword_duel', 2.0),
}

export type DuoRole = 'a' | 'b'

export const duoScene = (code: string | null | undefined): DuoScene | null =>
  isDuoEmote(code) ? DUO_SCENES[code as (typeof DUO_EMOTE_CODES)[number]] : null

export const duoClipName = (scene: DuoScene, role: DuoRole): string => 'animation.duo.' + scene.clip + '.' + role
