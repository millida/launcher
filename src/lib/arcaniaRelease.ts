import { usePromo } from '../state/promo'

export const ARCANIA2_PUBLIC = false

export const ARCANIA_SLUG = 'arcania'
export const ARCANIA_LEGACY_VERSION = '1.4.3'
export const ARCANIA2_SLUG = 'arcania-2'

const released = (remote: boolean): boolean => ARCANIA2_PUBLIC || remote

export const arcania2Live = (): boolean => released(usePromo.getState().promo.arcania2)

export const useArcania2Live = (): boolean => usePromo((s) => released(s.promo.arcania2))

export const isArcania2 = (slug: string | null | undefined, live: boolean): boolean => live && slug === ARCANIA2_SLUG

export function watchArcania2(onRelease: () => void): () => void {
  let done = false
  const apply = (live: boolean) => {
    if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-arcania2', live)
    if (!live || done) return
    done = true
    onRelease()
  }
  apply(arcania2Live())
  return usePromo.subscribe((s) => apply(released(s.promo.arcania2)))
}

/** Once 2.0 is out, 1.4.3 is reachable only from the 2.0 page and from an installed build, never from a list. */
export const isArcaniaLegacy = (slug: string | null | undefined, live: boolean): boolean => live && slug === ARCANIA_SLUG

export const withoutArcaniaLegacy = <T extends { slug?: string | null; id?: string }>(list: readonly T[], live: boolean): T[] =>
  list.filter((p) => !isArcaniaLegacy(p.slug ?? p.id, live))

export const arcaniaLead = (live: boolean): string => (live ? ARCANIA2_SLUG : ARCANIA_SLUG)
