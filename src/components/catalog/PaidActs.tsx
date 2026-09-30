import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { backdropClose } from '../../lib/dismiss'
import { hasMillidaAccount } from '../../lib/api'
import { pickTargetName } from '../../lib/installKeys'
import { useInstalls } from '../../state/installs'
import { useMods } from '../../state/mods'
import { useProfiles } from '../../state/profiles'
import { buyLabel, isPaid, priceTag, rubles, shortfallKopecks } from './paid'
import type { Pricing } from './paid'
import { closeBuy, confirmBuy, loadAccess, startPaid, usePaid } from './paidStore'
import { MILLIDA_KINDS, installMillidaItem, millidaKey, millidaPid } from './millidaInstall'
import type { SiteCard, SiteSection } from './site'
import { displayName } from './site'

/*
 * Кнопки платного и собственного материала каталога Millida в строке ленты:
 * «Купить» / «Подписаться» до доступа, «В сборку» / «Установить» после.
 * Окно покупки одно на каталог (`BuyModal`).
 */

/** Платный материал и открыт ли к нему доступ. Доступ спрашивается только у платных и только со входом. */
export function usePaidCard(card: Pick<SiteCard, 'slug' | 'pricing' | 'priceKopecks'>) {
  const paid = isPaid(card.pricing, card.priceKopecks)
  const access = usePaid((s) => s.access[card.slug] || 'unknown')
  const waiting = usePaid((s) => !!s.waiting[card.slug])
  useEffect(() => {
    if (paid && hasMillidaAccount()) void loadAccess(card.slug)
  }, [paid, card.slug])
  return { paid, open: access === 'open', locked: paid && access !== 'open', waiting }
}

/** Цена или «Куплено» — справа в строке. */
export function PriceMark({ card, fallback }: { card: SiteCard; fallback?: string }) {
  const p = usePaidCard(card)
  if (p.paid && p.open) return <span className="mr-owned">Куплено</span>
  const text = priceTag(card.pricing, card.priceKopecks) || fallback || ''
  return text ? <span className="mr-price">{text}</span> : null
}

/** «Купить» / «Подписаться» / «Ждём оплату» вместо установки, пока доступа нет. */
export function BuyBar({ card, extra, onOwned }: { card: SiteCard; extra?: ReactNode; onOwned: () => void }) {
  const p = usePaidCard(card)
  const label = p.waiting ? 'Ждём оплату' : buyLabel(card.pricing)
  return (
    <div className="mr-actions">
      {extra}
      <button
        className="btn sm primary mr-buy"
        data-track={card.pricing === 'SUBSCRIPTION' ? 'catalog_subscribe' : 'catalog_buy'}
        data-id={card.slug}
        disabled={p.waiting}
        aria-busy={p.waiting || undefined}
        onClick={(e) => {
          e.stopPropagation()
          void startPaid(
            { slug: card.slug, title: displayName(card.title), pricing: card.pricing as Pricing, priceKopecks: card.priceKopecks as number },
            onOwned,
          )
        }}
      >
        <Icon id="i-wallet" />
        {label}
      </button>
    </div>
  )
}

/** Своя вещь Millida без источника на Modrinth: ставится файлом каталога. */
export function NativeBar({ card, sec, extra }: { card: SiteCard; sec: SiteSection; extra?: ReactNode }) {
  const scoped = useMods((s) => s.targetBuild)
  const profiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const installed = useMods((s) => s.installedIds.has(millidaPid(card.slug)))
  const target = pickTargetName(scoped, profiles.map((x) => x.name), selected || '')
  const task = useInstalls((s) => s.tasks[millidaKey(target, sec.kind, card.slug)])
  const doneKey = useInstalls((s) => !!s.done[millidaKey(target, sec.kind, card.slug)])
  const running = !!task && task.state === 'run'
  const done = installed || doneKey
  const content = sec.kind !== 'world'
  const label = running ? (task!.pct > 0 ? task!.label + ' ' + Math.round(task!.pct) + '%' : task!.label) : done ? 'Установлено' : content ? 'В сборку' : 'Установить'
  return (
    <div className="mr-actions">
      {extra}
      <button
        className={'btn sm ' + (done ? 'secondary done' : 'primary')}
        data-track={done ? 'installed' : 'install_millida'}
        disabled={running}
        onClick={(e) => {
          e.stopPropagation()
          if (done) return
          void installMillidaItem({ slug: card.slug, title: displayName(card.title), kind: sec.kind, paid: isPaid(card.pricing, card.priceKopecks) })
        }}
      >
        {content && !done && !running ? <Icon id="i-plus" /> : null}
        {label}
      </button>
    </div>
  )
}

export const nativeKind = (sec: SiteSection): boolean => MILLIDA_KINDS.has(sec.kind)

/** Окно покупки: цена, баланс, одна главная кнопка. */
export function BuyModal() {
  const d = usePaid((s) => s.dialog)
  const balance = usePaid((s) => s.balance)
  const busy = usePaid((s) => s.busy)
  useEffect(() => {
    if (!d) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeBuy()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [!!d])
  if (!d) return null
  const sub = d.pricing === 'SUBSCRIPTION'
  const funds = d.step === 'funds'
  const short = shortfallKopecks(d.priceKopecks, balance)
  const head = funds ? (short ? 'Не хватает ' + rubles(short) : 'Не хватает денег') : sub ? 'Подписка «' + d.title + '»' : 'Купить «' + d.title + '»'
  const line = funds ? 'Пополни кошелёк и вернись' : d.repriced ? 'Цена изменилась' : sub ? 'Оплата на следующем шаге' : 'Спишем с кошелька Millida'
  const cta = funds ? 'Пополнить' : sub ? 'Оформить' : 'Купить'
  return createPortal(
    <div className="modal-bg open vis cat-buy-bg" {...backdropClose(closeBuy)}>
      <div className="modal mw-xs cat-buy" role="dialog" aria-label={head} data-step={d.step}>
        <h3>{head}</h3>
        <div className="cat-buy-price">{priceTag(d.pricing, d.priceKopecks)}</div>
        <div className={'sub cat-buy-line' + (d.repriced && !funds ? ' is-warn' : '')}>{line}</div>
        {sub ? null : (
          <div className="cat-buy-wallet">
            <span>Баланс</span>
            {balance === null ? <span className="skel skel-line" style={{ width: 64 }} /> : <b>{rubles(balance)}</b>}
          </div>
        )}
        <div className="cat-buy-btns">
          <button className="btn md secondary" disabled={busy} onClick={closeBuy}>
            Отмена
          </button>
          <button
            className={'btn md primary' + (busy ? ' cat-busy' : '')}
            data-track={funds ? 'catalog_topup' : sub ? 'catalog_subscribe_confirm' : 'catalog_buy_confirm'}
            data-nosound
            disabled={busy}
            aria-busy={busy || undefined}
            autoFocus
            onClick={() => void confirmBuy()}
          >
            {funds ? <Icon id="i-ext" /> : null}
            {cta}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
