import type { WardrobeItem } from './gameProfile'

export const STANDARD_SKIN_SIDE = 64

export interface SkinLockInput {
  millidaSkin: boolean
  plusActive: boolean
  orderedSkin: boolean
  skinWidth: number
}

export type SkinLockVerdict = 'play' | 'hd-needs-plus'

export function skinLockVerdict(input: SkinLockInput): SkinLockVerdict {
  if (!input.millidaSkin || input.plusActive || input.orderedSkin) return 'play'
  return input.skinWidth > STANDARD_SKIN_SIDE ? 'hd-needs-plus' : 'play'
}

const textureKey = (url: string) => url.split(/[?#]/)[0] ?? url

export function isOrderedSkin(activeUrl: string | null | undefined, items: readonly Pick<WardrobeItem, 'kind' | 'url' | 'source'>[]): boolean {
  if (!activeUrl) return false
  const key = textureKey(activeUrl)
  return items.some((i) => i.kind === 'skin' && i.source === 'order' && textureKey(i.url) === key)
}
