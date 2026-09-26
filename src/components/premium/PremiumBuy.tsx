import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { showToast } from '../../state/ui'
import { track } from '../../lib/telemetry'
import { useModpackVersions } from '../../state/modpack'
import { watchPackPurchase } from '../../state/packWatch'
import { PackInstallButton } from './PackInstall'
import { purchaseFlow } from '../../lib/purchaseTrack'
import { openPaymentUrl } from '../../lib/openPayment'
import {
  buyPremiumPack,
  planPrice,
  priceLabel,
  subscribePremium,
  untilText,
  viaCatalog,
  type PremiumPack,
  type PremiumPlan,
  type PremiumSubscription,
} from '../../lib/premium'

export interface BuyProps {
  pack: PremiumPack
  plan?: PremiumPlan | null
  sub?: PremiumSubscription | null
  /// Второй блок цены внизу страницы: тот же смысл, крупнее подложка.
  wide?: boolean
}

/// Доступ есть: подписка активна и сборка в ней, либо куплена разово.
export const hasAccess = (pack: PremiumPack, sub?: PremiumSubscription | null): boolean =>
  !!pack.owned || (!!sub?.active && !!pack.inSubscription)

/** Оплата идёт в браузере: исход для лаунчера — открылась ли страница оплаты. */
async function openPayment(
  run: () => Promise<{ paymentUrl: string }>,
  result: (ok: boolean, reason?: 'checkout' | 'error', err?: unknown) => void,
) {
  try {
    const answer = await run()
    if (answer && answer.paymentUrl) {
      const opened = openPaymentUrl(answer.paymentUrl)
      result(opened, opened ? 'checkout' : 'error', opened ? undefined : 'payment_url_not_opened')
    } else {
      result(false, 'error', 'no_payment_url')
      showToast('Оплата не открылась', 'error')
    }
  } catch (e) {
    result(false, 'error', e)
    showToast('Оплата не открылась', 'error')
  }
}

export function installPack(pack: PremiumPack) {
  if (!pack.slug) {
    showToast('Сборка ещё не готова', 'error')
    return
  }
  void useModpackVersions.getState().openInstall(pack.slug, pack.title)
}

/// Главная кнопка сборки. Одна primary на зону — всё остальное рядом ghost.
export function BuyButton({ pack, plan, sub, size }: BuyProps & { size?: 'sm' }) {
  const cls = 'btn primary' + (size === 'sm' ? ' sm' : '')
  // Сборка каталога: цены у нас нет, доступ проверяет сервер при установке.
  if (viaCatalog(pack)) return <PackInstallButton pack={pack} size={size} />
  if (hasAccess(pack, sub))
    return (
      <button className={cls} data-track="install" data-kind="premium" data-id={pack.slug || pack.id} onClick={() => installPack(pack)}>
        <Icon id="i-download" /> Установить
      </button>
    )
  if (pack.inSubscription && plan)
    return (
      <button
        className={cls}
        data-track="premium_subscribe"
        data-kind="premium"
        data-id={pack.slug || pack.id}
        onClick={() => {
          track('store_open', { where: 'premium_subscribe' })
          const result = purchaseFlow('premium_sub', plan.id + ':' + (pack.slug || pack.id), plan.priceKopecks ?? undefined, 'kopecks')
          void openPayment(() => subscribePremium(plan.id, pack.id), result)
        }}
      >
        <Icon id="i-crown" /> Оформить
      </button>
    )
  if (typeof pack.priceKopecks === 'number' && pack.priceKopecks > 0)
    return (
      <button
        className={cls}
        data-track="premium_buy"
        data-kind="premium"
        data-id={pack.slug || pack.id}
        onClick={() => {
          track('store_open', { where: 'premium_buy' })
          const result = purchaseFlow('premium_pack', pack.slug || pack.id, pack.priceKopecks ?? undefined, 'kopecks')
          void openPayment(() => buyPremiumPack(pack.id), result)
        }}
      >
        <Icon id="i-gem" /> Купить
      </button>
    )
  return null
}

/// Сборка партнёра открывается двумя подписками: ею одной или всеми сборками
/// партнёра. Главная кнопка — все сборки: партнёр продвигает общую подписку.
export function PlanButtons({
  pack,
  plans,
  onOwned,
  size,
  wrap,
}: {
  pack: PremiumPack
  plans: PremiumPlan[]
  onOwned: () => void
  size?: 'sm'
  /// Класс обёртки каждой кнопки: у колонки покупки кнопка на всю ширину.
  wrap?: string
}) {
  const [waiting, setWaiting] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  const id = pack.slug || pack.id
  const sm = size === 'sm' ? ' sm' : ''

  const start = (plan: PremiumPlan) => {
    track('store_open', { where: 'premium_subscribe' })
    const result = purchaseFlow('premium_sub', plan.id + ':' + id, plan.priceKopecks, 'kopecks')
    void openPayment(
      () => subscribePremium(plan.id, id),
      (ok, reason, err) => {
        result(ok, reason, err)
        if (!ok) return
        setWaiting(true)
        stop.current?.()
        stop.current = watchPackPurchase(pack.id, () => {
          setWaiting(false)
          showToast('Подписка оформлена')
          onOwned()
        })
      },
    )
  }

  const boxed = (key: string, node: ReactNode) =>
    wrap ? (
      <span className={wrap} key={key}>
        {node}
      </span>
    ) : (
      <span key={key} style={{ display: 'contents' }}>
        {node}
      </span>
    )

  if (waiting)
    return boxed(
      'wait',
      <button className={'btn primary' + sm} disabled aria-busy="true">
        <Icon id="i-clock" /> Ждём оплату
      </button>,
    )
  const ordered = [...plans].sort((a, b) => Number(a.id === 'pack') - Number(b.id === 'pack'))
  return (
    <>
      {ordered.map((plan, i) =>
        boxed(
          plan.id,
          <button
            className={'btn ' + (i === 0 ? 'primary' : 'secondary') + sm}
            data-track="premium_subscribe"
            data-kind="premium"
            data-id={id}
            data-plan={plan.id}
            onClick={() => start(plan)}
          >
            <Icon id={i === 0 ? 'i-crown' : 'i-blocks'} /> {plan.id === 'pack' ? 'Эта сборка' : plan.title || 'Все сборки'} · {planPrice(plan)}
          </button>,
        ),
      )}
    </>
  )
}

/// Цена рядом с кнопкой: подписка отдельной строкой от разовой цены, чтобы они
/// не спорили. Срок и отмена показаны честно (ФЗ о рекламе, ст. 6).
export function PriceLine({ pack, plan, sub }: BuyProps) {
  if (hasAccess(pack, sub)) {
    const until = untilText(sub?.paidUntil)
    return (
      <span className="pm-price">
        <b>Доступ открыт</b>
        {sub?.active && until ? <i>Подписка до {until}</i> : null}
      </span>
    )
  }
  const main = priceLabel(pack, plan)
  if (!main) return null
  const alsoOnce =
    pack.inSubscription && plan && typeof pack.priceKopecks === 'number' && pack.priceKopecks > 0
  return (
    <span className="pm-price">
      <b>{main}</b>
      {alsoOnce ? <i>или {priceLabel({ ...pack, inSubscription: false })} разово</i> : null}
      {!pack.inSubscription ? <i>Покупка навсегда</i> : null}
    </span>
  )
}

/// Повтор блока цены внизу страницы сборки: возвращаться наверх не нужно.
export function BuyBlock({ pack, plan, sub }: BuyProps) {
  const access = hasAccess(pack, sub)
  return (
    <div className="pm-buy">
      <div className="pm-buy-left">
        <b>{pack.title}</b>
        <PriceLine pack={pack} plan={plan} sub={sub} />
      </div>
      <div className="pm-buy-right">
        <BuyButton pack={pack} plan={plan} sub={sub} />
        {plan && pack.inSubscription && !access ? <span className="pm-plan">{plan.title}</span> : null}
      </div>
    </div>
  )
}

/// Отмена не прячется: ссылка стоит там же, где подписка.
export function CancelLine({ sub }: { sub?: PremiumSubscription | null }) {
  if (!sub) return null
  if (sub.active)
    return (
      <div className="pm-note">
        <Icon id="i-info" />
        {sub.canceled ? (
          <span>Продление выключено{untilText(sub.paidUntil) ? ', доступ до ' + untilText(sub.paidUntil) : ''}</span>
        ) : (
          <span>Списание каждый месяц{untilText(sub.paidUntil) ? ', следующее ' + untilText(sub.paidUntil) : ''}</span>
        )}
        {sub.manageUrl ? (
          <button className="btn sm ghost" data-track="premium_cancel" onClick={() => openPaymentUrl(sub.manageUrl)}>
            Отменить
          </button>
        ) : null}
      </div>
    )
  return (
    <div className="pm-note">
      <Icon id="i-info" />
      <span>Отмена в любой момент</span>
      {sub.manageUrl ? (
        <button className="btn sm ghost" data-track="premium_manage" onClick={() => openPaymentUrl(sub.manageUrl)}>
          Подписка
        </button>
      ) : null}
    </div>
  )
}
