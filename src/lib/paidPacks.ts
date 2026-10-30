import { getMarket, marketOffers } from '../i18n'

export const ARCANIA_PARTNER = 'arcania-labs'

/// Paid packs of these partners are sold in every interface language; the API keeps the same list.
const WORLDWIDE_PARTNERS: ReadonlySet<string> = new Set([ARCANIA_PARTNER])

export const sellsPaidPacks = (): boolean => marketOffers(getMarket(), 'paid-packs')

export const sellsPartnerPacks = (partnerSlug: string | null | undefined): boolean =>
  sellsPaidPacks() || (!!partnerSlug && WORLDWIDE_PARTNERS.has(partnerSlug))

/// Applied when a list is read, not when it is cached: a cache filled on the Russian market must
/// not show paid packs after the player switches to another language.
export function marketPacks<T extends { accessRequired?: boolean; partner?: { slug: string } | null }>(list: readonly T[]): T[] {
  return list.filter((p) => !p.accessRequired || sellsPartnerPacks(p.partner?.slug))
}
