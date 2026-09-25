import { track, trackFailure } from './telemetry'
import { actionSource } from './uiTrack'

/**
 * Воронка покупки: `purchase_start` в момент нажатия «Купить» и одна запись
 * `purchase_result` на исход — куплено, отказался в подтверждении, не хватило,
 * ошибка службы. Для оплаты во внешнем браузере (PLUS, премиум-сборки,
 * заказ скина) исход «checkout» значит «страница оплаты открылась»: сама
 * оплата в лаунчер не приходит, кроме PLUS — её ловит watchPlusPurchase.
 *
 * product: item | bundle | xray | craft | weekly_boost | ruby_pack | ruby_topup |
 *          plus | premium_pack | premium_sub | skin_order | chest
 * price — в той валюте, что `cur`: rubies | shards | kopecks.
 */
export type PurchaseReason = 'cancel' | 'insufficient' | 'error' | 'checkout' | 'signin'

export function purchaseFlow(product: string, id: string, price?: number, cur?: 'rubies' | 'shards' | 'kopecks') {
  const base = { product, id: (id || '').slice(0, 64) }
  const start: Record<string, string | number> = { ...base, source: actionSource('shop').source }
  if (typeof price === 'number' && price > 0) start.price = price
  if (cur) start.cur = cur
  track('purchase_start', start)
  let done = false
  return (ok: boolean, reason?: PurchaseReason, err?: unknown) => {
    if (done) return
    done = true
    const data: Record<string, string | number | boolean> = { ...base, ok }
    if (reason) data.reason = reason
    track('purchase_result', data, { ok })
    // Сбой службы — ещё и событие error с текстом и классом; отказ и нехватка
    // средств — ответ игроку, не сбой.
    if (reason === 'error') trackFailure('purchase', err ?? 'purchase_error:' + product, { product })
  }
}
