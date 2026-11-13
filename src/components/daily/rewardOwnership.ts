import type { ChestDrop } from '../../lib/rubies'
import { splitVariantCode } from '../../lib/variantNames'

/** Only a whole new item (or a completed fragment set) is an ownership grant. */
export function grantedCodes(drops: readonly ChestDrop[]): string[] {
  return drops.flatMap((drop) => {
    if (drop.kind !== 'ITEM' && drop.kind !== 'FRAGMENTS') return []
    if (drop.kind === 'ITEM' ? drop.duplicate : !drop.completed) return []
    if (!drop.item?.code) return []
    const code = drop.item.code
    return [code.includes('~') || !drop.variant?.name ? code : code + '~' + drop.variant.name]
  })
}

/**
 * The owned list names a variant only for items the catalog split into several (and only once
 * the catalog is loaded): a single-colour item or a cold catalog lists the bare code, while the
 * drop names its variant. Comparing the codes as-is told the player to write to support about an
 * item that was there (13.11.2026). A bare code covers its variants and a variant covers its item.
 */
export function missingGrantedCodes(drops: readonly ChestDrop[], owned: readonly string[]): string[] {
  const have = new Set(owned)
  const bases = new Set(owned.map((code) => splitVariantCode(code).code))
  return grantedCodes(drops).filter((code) => {
    if (have.has(code)) return false
    const { code: base, variant } = splitVariantCode(code)
    return variant ? !have.has(base) : !bases.has(base)
  })
}
