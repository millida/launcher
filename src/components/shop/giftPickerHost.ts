import { lazyHost } from '../../lib/lateMount'
import { useGiftPick } from './giftPick'

export const GiftPickerHost = lazyHost(
  () => import('./GiftFriends').then((m) => ({ default: m.GiftPickerHost })),
  () => useGiftPick((s) => !!s.ask),
)
