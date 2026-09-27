/**
 * What one worn item takes away from the rest of the outfit, decided exactly
 * as the mod decides it (core CosmeticCover, MeshPose, CosmeticSide, SkinMask,
 * SkinCoverage, CapeRule). Every launcher preview dresses the figure through
 * this module, so a combination looks the same here and in the game.
 */

export interface CoverItem {
  id: string
  baseId?: string
  slot: string
  hides?: unknown
  masks?: unknown
  side?: string
}

export interface CoverBone {
  name: string
  parent: number
  side?: string
}

export interface PieceCover {
  bones: ReadonlySet<string>
  side?: string
}

export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

const SIDE_ORDER = ['left', 'right', 'front', 'back']

const MASK_SIZE = 64
const DARK = 128
const FULLY = 0.95
const MOSTLY = 0.6

type Rect = [number, number, number, number]

interface SkinPart {
  name: string
  wide: Rect[]
  slim?: Rect[]
  overlay: boolean
  layer?: string
}

const SKIN_PARTS: SkinPart[] = [
  { name: 'HEAD', wide: [[8, 0, 24, 8], [0, 8, 32, 16]], overlay: false, layer: 'HAT' },
  { name: 'HAT', wide: [[40, 0, 56, 8], [32, 8, 64, 16]], overlay: true },
  { name: 'BODY', wide: [[20, 16, 36, 20], [16, 20, 40, 32]], overlay: false, layer: 'JACKET' },
  { name: 'JACKET', wide: [[20, 32, 36, 36], [16, 36, 40, 48]], overlay: true },
  {
    name: 'RIGHT_ARM',
    wide: [[44, 16, 52, 20], [40, 20, 56, 32]],
    slim: [[44, 16, 50, 20], [40, 20, 54, 32]],
    overlay: false,
    layer: 'RIGHT_SLEEVE',
  },
  {
    name: 'RIGHT_SLEEVE',
    wide: [[44, 32, 52, 36], [40, 36, 56, 48]],
    slim: [[44, 32, 50, 36], [40, 36, 54, 48]],
    overlay: true,
  },
  {
    name: 'LEFT_ARM',
    wide: [[36, 48, 44, 52], [32, 52, 48, 64]],
    slim: [[36, 48, 42, 52], [32, 52, 46, 64]],
    overlay: false,
    layer: 'LEFT_SLEEVE',
  },
  {
    name: 'LEFT_SLEEVE',
    wide: [[52, 48, 60, 52], [48, 52, 64, 64]],
    slim: [[52, 48, 58, 52], [48, 52, 62, 64]],
    overlay: true,
  },
  { name: 'RIGHT_LEG', wide: [[4, 16, 12, 20], [0, 20, 16, 32]], overlay: false, layer: 'RIGHT_PANTS' },
  { name: 'RIGHT_PANTS', wide: [[4, 32, 12, 36], [0, 36, 16, 48]], overlay: true },
  { name: 'LEFT_LEG', wide: [[20, 48, 28, 52], [16, 52, 32, 64]], overlay: false, layer: 'LEFT_PANTS' },
  { name: 'LEFT_PANTS', wide: [[4, 48, 12, 52], [0, 52, 16, 64]], overlay: true },
]

const normalise = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  return trimmed ? trimmed : undefined
}

/** The catalog writes hide rules against the item code, not against a colourway card. */
export const coverId = (item: CoverItem): string => item.baseId ?? item.id

export function hideRules(value: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, bones] of Object.entries(value as Record<string, unknown>)) {
    const names = new Set<string>()
    if (Array.isArray(bones)) {
      for (const bone of bones) {
        if (typeof bone === 'string' && bone.trim()) names.add(bone.trim())
      }
    } else if (bones && typeof bones === 'object') {
      for (const [bone, on] of Object.entries(bones as Record<string, unknown>)) {
        if (on === true) names.add(bone)
      }
    }
    if (names.size) out.set(key, names)
  }
  return out
}

/** Bones of `item` that the rest of the outfit covers, lower-cased for a case-blind match. */
export function hiddenBones(outfit: readonly CoverItem[], item: CoverItem): Set<string> {
  const target = coverId(item)
  const bones = new Set<string>()
  for (const other of outfit) {
    if (coverId(other) === target) continue
    for (const bone of hideRules(other.hides).get(target) ?? []) bones.add(bone.toLowerCase())
  }
  return bones
}

export function pieceCover(outfit: readonly CoverItem[], item: CoverItem): PieceCover {
  return { bones: hiddenBones(outfit, item), side: item.side }
}

export function chosenSide(options: ReadonlySet<string>, worn?: string, declared?: string): string | undefined {
  if (!options.size) return undefined
  const picked = normalise(worn)
  if (picked && options.has(picked)) return picked
  const fallback = normalise(declared)
  if (fallback && options.has(fallback)) return fallback
  for (const candidate of SIDE_ORDER) {
    if (options.has(candidate)) return candidate
  }
  return options.values().next().value
}

/** Which bones of one piece stay out of the frame; bones come parents first, as in the rig. */
export function hiddenJoints(bones: readonly CoverBone[], cover: PieceCover | undefined): boolean[] {
  const options = new Set<string>()
  for (const bone of bones) {
    const own = normalise(bone.side)
    if (own) options.add(own)
  }
  const side = chosenSide(options, undefined, cover?.side)
  const hidden: boolean[] = []
  bones.forEach((bone, i) => {
    const own = normalise(bone.side)
    hidden[i] =
      (cover?.bones.has(bone.name.toLowerCase()) ?? false) ||
      (side !== undefined && own !== undefined && own !== side) ||
      (bone.parent >= 0 && bone.parent < i && hidden[bone.parent] === true)
  })
  return hidden
}

export function maskUrl(item: CoverItem, slim: boolean, side?: string): string | undefined {
  const masks = new Map<string, string>()
  if (item.masks && typeof item.masks === 'object' && !Array.isArray(item.masks)) {
    for (const [key, value] of Object.entries(item.masks as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) masks.set(key.toLowerCase(), value.trim())
    }
  }
  const anySide = (model: string) => {
    const keys = [...masks.keys()].filter((key) => key.startsWith(model + '.')).sort()
    return keys.length ? masks.get(keys[0] as string) : undefined
  }
  const model = slim ? 'alex' : 'steve'
  const other = slim ? 'steve' : 'alex'
  const wanted = normalise(side)
  return (
    (wanted ? masks.get(model + '.' + wanted) : undefined) ??
    masks.get(model) ??
    anySide(model) ??
    masks.get(other) ??
    anySide(other)
  )
}

/** Skin masks of the outfit; an emote's own mask counts only while it plays. */
export function maskUrls(outfit: readonly CoverItem[], slim: boolean, playingEmote?: CoverItem): string[] {
  const urls: string[] = []
  const emote = playingEmote ? maskUrl(playingEmote, slim, playingEmote.side) : undefined
  if (emote) urls.push(emote)
  for (const item of outfit) {
    if (item.slot === 'EMOTE') continue
    const url = maskUrl(item, slim, item.side)
    if (url && !urls.includes(url)) urls.push(url)
  }
  return urls.sort()
}

export function hidesRegularCape(outfit: readonly CoverItem[]): boolean {
  return outfit.some((item) => item.slot === 'CAPE')
}

const covered = (data: Uint8ClampedArray, at: number) =>
  (data[at + 3] as number) !== 0 &&
  (data[at] as number) < DARK &&
  (data[at + 1] as number) < DARK &&
  (data[at + 2] as number) < DARK

export function maskHidesAnything(mask: Pixels): boolean {
  for (let at = 0; at < mask.width * mask.height * 4; at += 4) {
    if (covered(mask.data, at)) return true
  }
  return false
}

/** Parts of the body a mask covers whole, which the game then leaves undrawn. */
export function coveredParts(mask: Pixels, slim: boolean): Set<string> {
  const parts = new Set<string>()
  if (mask.width <= 0 || mask.height <= 0 || mask.data.length < mask.width * mask.height * 4) return parts
  for (const part of SKIN_PARTS) {
    let seen = 0
    let hidden = 0
    for (const [x0, y0, x1, y1] of (slim && part.slim) || part.wide) {
      for (let y = y0; y < y1; y += 1) {
        const maskY = Math.floor((y * mask.height) / MASK_SIZE)
        for (let x = x0; x < x1; x += 1) {
          const maskX = Math.floor((x * mask.width) / MASK_SIZE)
          seen += 1
          if (covered(mask.data, (maskY * mask.width + maskX) * 4)) hidden += 1
        }
      }
    }
    if (seen > 0 && hidden >= seen * (part.overlay ? MOSTLY : FULLY)) parts.add(part.name)
  }
  return parts
}

/**
 * Cuts the skin under the outfit in place: the mask's black pixels, then every
 * part a mask covers whole. Returns whether anything changed.
 */
export function cutSkin(skin: Pixels, masks: readonly Pixels[], slim: boolean): boolean {
  if (skin.width <= 0 || skin.height <= 0 || skin.data.length < skin.width * skin.height * 4) return false
  // A legacy 64x32 skin is the top half of the layout, not the layout scaled down.
  const layoutHeight = skin.width === skin.height * 2 ? skin.height * 2 : skin.height
  let changed = false
  const parts = new Set<string>()
  for (const mask of masks) {
    if (mask.width <= 0 || mask.height <= 0 || mask.data.length < mask.width * mask.height * 4) continue
    if (!maskHidesAnything(mask)) continue
    changed = true
    for (let y = 0; y < skin.height; y += 1) {
      const maskY = Math.floor((y * mask.height) / layoutHeight)
      for (let x = 0; x < skin.width; x += 1) {
        const maskX = Math.floor((x * mask.width) / skin.width)
        if (covered(mask.data, (maskY * mask.width + maskX) * 4)) skin.data.fill(0, (y * skin.width + x) * 4, (y * skin.width + x) * 4 + 4)
      }
    }
    for (const part of coveredParts(mask, slim)) parts.add(part)
  }
  // Since 1.21.2 each overlay part hangs under its body part, so hiding the body part hides its overlay too.
  for (const part of SKIN_PARTS) {
    if (part.layer && parts.has(part.name)) parts.add(part.layer)
  }
  for (const part of SKIN_PARTS) {
    if (!parts.has(part.name)) continue
    for (const [x0, y0, x1, y1] of (slim && part.slim) || part.wide) {
      const fromY = Math.floor((y0 * layoutHeight) / MASK_SIZE)
      const toY = Math.min(skin.height, Math.floor((y1 * layoutHeight) / MASK_SIZE))
      const fromX = Math.floor((x0 * skin.width) / MASK_SIZE)
      const toX = Math.floor((x1 * skin.width) / MASK_SIZE)
      for (let y = fromY; y < toY; y += 1) skin.data.fill(0, (y * skin.width + fromX) * 4, (y * skin.width + toX) * 4)
    }
  }
  return changed
}
