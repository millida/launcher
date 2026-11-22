import type { ReceivedGift, SentGift } from '../../lib/gifts'
import { intlTag, t } from '../../i18n'

type AnyGift = Pick<ReceivedGift | SentGift, 'kind' | 'item' | 'rubies' | 'tier'>

/** Gifts from before rubies and PLUS could be given carry no kind: they are items. */
export const giftKind = (g: AnyGift) => g.kind ?? 'ITEM'

export function giftLabel(g: AnyGift): string {
  const kind = giftKind(g)
  if (kind === 'RUBIES') return t('Рубины: {n}', { n: (g.rubies ?? 0).toLocaleString(intlTag()) })
  if (kind === 'PLUS') return g.tier === 'DIAMOND' ? t('PLUS Diamond на месяц') : t('PLUS на месяц')
  return g.item?.name || t('Подарок')
}

/** Pixel art name for a gift that has no item preview. */
export const giftArt = (g: AnyGift): string => (giftKind(g) === 'PLUS' ? (g.tier === 'DIAMOND' ? 'gem' : 'crown') : 'gift')
