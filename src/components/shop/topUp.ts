import { apiErrorText } from '../../lib/apiError'
import { completeFragments, type ItemRef } from '../../lib/rubies'
import { purchaseFlow } from '../../lib/purchaseTrack'
import { uiConfirm } from '../../state/confirm'
import { showToast } from '../../state/ui'
import { word } from './rarity'
import { intlTag, t } from '../../i18n'

/**
 * «Докупить фрагменты»: одна покупка для итогов сундука, «Собираются»,
 * плащей за часы и подарка новичку. Цена — у кнопки, подтверждение — всегда,
 * нехватка — строкой от службы. Успех возвращается только после ответа службы.
 */
export async function topUpFragments(
  item: { code: string; name: string },
  price: number,
): Promise<{ balance: number; granted: ItemRef[] } | null> {
  const result = purchaseFlow('fragments', item.code, price, 'rubies')
  const ok = await uiConfirm(t('{name}: докупить недостающие фрагменты за {price} {word}', { name: item.name, price: price.toLocaleString(intlTag()), word: word(price) }), {
    title: t('Докупить фрагменты'),
    confirmLabel: t('Докупить'),
    danger: false,
  })
  if (!ok) {
    result(false, 'cancel')
    return null
  }
  try {
    const res = await completeFragments(item.code)
    result(true)
    return res
  } catch (e) {
    result(false, 'error', e)
    showToast(apiErrorText(e, t('Магазин не ответил, попробуй позже')), 'error')
    return null
  }
}
