import { getMarket, marketOffers } from '../i18n'

export const sellsPaidPacks = (): boolean => marketOffers(getMarket(), 'paid-packs')

/// Applied when a list is read, not when it is cached: a cache filled on the Russian market must
/// not show paid packs after the player switches to another language.
export function marketPacks<T extends { accessRequired?: boolean }>(list: readonly T[]): T[] {
  return sellsPaidPacks() ? [...list] : list.filter((p) => !p.accessRequired)
}
