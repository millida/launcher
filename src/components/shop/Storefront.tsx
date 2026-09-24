import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { trackImpression } from '../../lib/uiTrack'
import { Icon } from '../Icon'
import type { ItemRef, ShopBundle, ShopCard, ShopSource } from '../../lib/rubies'
import { cosmeticSlotName } from '../../lib/cosmeticSlots'
import { gridCols, Head, ItemArt, Price, Timer, toneStyle } from './parts'
import { FreeDaily } from './FreeDaily'
import { RARITY_ORDER } from './rarity'
import { FragBar, RarityFx, RarityPlate } from './rarityUi'

/** Мастхэвы первыми: легендарные и эпические в начале ряда, порядок службы внутри редкости. */
export const byRarity = (cards: ShopCard[]): ShopCard[] =>
  cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => RARITY_ORDER.indexOf(b.c.item.rarity) - RARITY_ORDER.indexOf(a.c.item.rarity) || a.i - b.i)
    .map((x) => x.c)

export interface BuyProps {
  balance: number
  busy: string
  wishlist: string[]
  onBuy: (card: ShopCard, source: ShopSource) => void
  onWish: (code: string, on: boolean) => void
}

/**
 * Сердце «Хочу»: уведомим, когда вещь вернётся (каждая возвращается не реже
 * раза в 60 дней). Живёт на самом предмете — в углу превью; пустое видно при
 * наведении на карточку, отмеченное — всегда (владелец 23.09.2026).
 */
export function WishBtn({ code, wishlist, onWish }: { code: string; wishlist: string[]; onWish: BuyProps['onWish'] }) {
  const on = wishlist.includes(code)
  return (
    <button
      className={'sh-wish' + (on ? ' on' : '')}
      aria-pressed={on}
      data-tip={on ? 'Уведомим, когда вернётся' : 'Хочу'}
      aria-label="Хочу"
      data-track={on ? 'wish_off' : 'wish_on'}
      onClick={(e) => {
        e.stopPropagation()
        onWish(code, !on)
      }}
    >
      <Icon id={on ? 'i-heart' : 'i-heart-off'} />
    </button>
  )
}

/**
 * Кнопка покупки: «Куплено» или «Купить». Рубинов не хватает — кнопка
 * спокойная (secondary), а нажатие честно говорит «не хватает N» и ведёт
 * к пакетам. Число на самой кнопке делало ряд карточек пёстрым.
 */
export function BuyBtn({
  card,
  source,
  balance,
  busy,
  onBuy,
  size = 'sm',
  label = 'Купить',
}: {
  card: ShopCard
  source: ShopSource
  balance: number
  busy: string
  onBuy: BuyProps['onBuy']
  size?: 'sm' | 'md'
  label?: string
}) {
  if (card.owned)
    return (
      <span className={'sh-owned ' + size}>
        <Icon id="i-check" />
        Куплено
      </span>
    )
  return (
    <button
      className={'btn ' + size + (card.price > balance ? ' secondary' : ' primary')}
      disabled={busy === card.item.code}
      data-track="buy"
      onClick={() => onBuy(card, source)}
    >
      {label}
    </button>
  )
}

/** Карточка витрины: одна клетка сетки, одна высота. Название, редкость, цена, кнопка. */
export function ItemCard({ card, source, i = 0, ...p }: { card: ShopCard; source: ShopSource; i?: number } & BuyProps) {
  const it = card.item
  return (
    <div
      className={'sh-card sh-shine' + (card.owned ? ' is-owned' : '')}
      style={{ ...toneStyle(it), ['--i' as string]: i }}
      data-rar={it.rarity}
      data-kind="offer"
      data-id={it.code}
      data-pos={i}
    >
      <RarityFx />
      {card.discountPct ? <span className="sh-off">−{card.discountPct}%</span> : null}
      {!card.owned ? <WishBtn code={it.code} wishlist={p.wishlist} onWish={p.onWish} /> : null}
      <ItemArt item={it} />
      <b className="sh-card-name">{it.name}</b>
      <span className="sh-card-meta">
        {card.fragments && !card.owned ? (
          <FragBar have={card.fragments.have} need={card.fragments.need} rarity={it.rarity} />
        ) : (
          <RarityPlate rarity={it.rarity} small />
        )}
      </span>
      <span className="sh-card-foot">
        <Price price={card.price} base={card.basePrice} />
        <BuyBtn card={card} source={source} balance={p.balance} busy={p.busy} onBuy={p.onBuy} />
      </span>
    </div>
  )
}

/** Карточка вещи без покупки (набор, «Хочу», PLUS): та же клетка, внизу — отметка. */
export function ShowCard({ item, foot, className = '' }: { item: ItemRef; foot?: ReactNode; className?: string }) {
  return (
    <div className={'sh-card is-show ' + className} style={toneStyle(item)} data-rar={item.rarity}>
      <RarityFx />
      <ItemArt item={item} />
      <b className="sh-card-name">{item.name}</b>
      <span className="sh-card-meta">
        <RarityPlate rarity={item.rarity} small />
      </span>
      {foot ? <span className="sh-card-foot">{foot}</span> : null}
    </div>
  )
}

/**
 * Витрина дня одним блоком (правка владельца 21:45: «слипся — на разделы»):
 * заголовок с одним таймером, ряд «предмет дня 6 + скидка 2», ряд из 8 вещей.
 * Подписи-кикеры («Предмет дня», «Скидка дня») и второй таймер убраны:
 * крупная карточка и плашка «−25%» говорят сами.
 */
export function Showcase({
  featured,
  deal,
  items,
  refreshAt,
  onTry,
  onEnd,
  ...p
}: { featured: ShopCard; deal: ShopCard; items: ShopCard[]; refreshAt: string; onTry: () => void; onEnd?: () => void } & BuyProps) {
  const f = featured.item
  const d = deal.item
  // Показ витрины дня — для CTR карточек: предмет дня, скидка, ряд вещей.
  const shown = [f.code, d.code, ...byRarity(items).map((c) => c.item.code)]
  const shownKey = shown.join(',')
  useEffect(() => {
    trackImpression('storefront', shown, 'rubies')
  }, [shownKey])
  return (
    <div className="card sh-block" data-section="storefront">
      <Head title="Витрина дня">
        <Timer to={refreshAt} label="Новая через" onEnd={onEnd} />
      </Head>
      <div className="sh-grid sh-hero has-gift">
        <FreeDaily />
        <div className="sh-feat sh-shine" style={toneStyle(f)} data-rar={f.rarity} data-kind="offer" data-id={f.code} data-pos={0}>
          <RarityFx />
          <span className="sh-feat-stage">
            <ItemArt item={f} size="lg" />
            {!featured.owned ? <WishBtn code={f.code} wishlist={p.wishlist} onWish={p.onWish} /> : null}
          </span>
          <span className="sh-feat-body">
            <b className="sh-feat-name">{f.name}</b>
            <span className="sh-card-meta">
              <RarityPlate rarity={f.rarity} />
              {cosmeticSlotName(f.slot)}
            </span>
            {featured.fragments && !featured.owned ? (
              <FragBar have={featured.fragments.have} need={featured.fragments.need} rarity={f.rarity} />
            ) : null}
            <Price price={featured.price} base={featured.basePrice} big />
            <span className="sh-feat-acts">
              <BuyBtn card={featured} source="featured" balance={p.balance} busy={p.busy} onBuy={p.onBuy} size="md" />
              <button className="btn md secondary" data-track="try_on" onClick={onTry}>
                Примерить
              </button>
            </span>
          </span>
        </div>
        <div
          className="sh-deal sh-shine"
          style={{ ...toneStyle(d), ['--i' as string]: 1 }}
          data-rar={d.rarity}
          data-kind="offer"
          data-id={d.code}
          data-pos={1}
        >
          <RarityFx />
          <span className="sh-off big">−{deal.discountPct}%</span>
          {!deal.owned ? <WishBtn code={d.code} wishlist={p.wishlist} onWish={p.onWish} /> : null}
          <ItemArt item={d} />
          <b className="sh-card-name">{d.name}</b>
          {deal.fragments && !deal.owned ? (
            <FragBar have={deal.fragments.have} need={deal.fragments.need} rarity={d.rarity} />
          ) : null}
          <span className="sh-card-foot">
            <Price price={deal.price} base={deal.basePrice} />
            <BuyBtn card={deal} source="deal" balance={p.balance} busy={p.busy} onBuy={p.onBuy} />
          </span>
        </div>
      </div>
      <div className="sh-grid sh-row2 is-fit" style={gridCols(items.length)}>
        {byRarity(items).map((c, i) => (
          <ItemCard key={c.item.code} card={c} source="day" i={i + 2} {...p} />
        ))}
      </div>
    </div>
  )
}

/** Наложенные превью вещей набора: сразу видно, что внутри, без значка-заглушки. */
export function Collage({ items }: { items: ItemRef[] }) {
  const shown = items.slice(0, 4)
  return (
    <span className={'sh-collage n' + shown.length}>
      {shown.map((it) => (
        <span key={it.code} className="sh-collage-i" style={toneStyle(it)}>
          {it.preview ? <img src={it.preview} alt="" draggable={false} loading="lazy" /> : null}
        </span>
      ))}
    </span>
  )
}

/** Набор: платишь только за то, чего ещё нет, полная сумма зачёркнута рядом. */
export function BundleCard({
  bundle,
  balance,
  busy,
  onBuy,
  onEnd,
}: {
  bundle: ShopBundle
  balance: number
  busy: string
  onBuy: (b: ShopBundle) => void
  onEnd?: () => void
}) {
  const missing = bundle.items.filter((c) => !c.owned).length
  const short = bundle.price - balance
  return (
    <div className="card sh-block sh-bundle" data-section="bundle" data-kind="offer" data-id={bundle.id}>
      <Head title={bundle.title}>
        <Timer to={bundle.leavesAt} label="Уйдёт через" onEnd={onEnd} />
        <span className="sh-head-act">
          <Price price={bundle.price} base={bundle.fullPrice} big />
          {missing === 0 ? (
            <span className="sh-owned md">
              <Icon id="i-check" />
              Всё есть
            </span>
          ) : (
            <button
              className={'btn md ' + (short > 0 ? 'secondary' : 'primary')}
              disabled={busy === bundle.id}
              data-track="buy_bundle"
              onClick={() => onBuy(bundle)}
            >
              {missing < bundle.items.length ? 'Докупить ' + missing : 'Купить набор'}
            </button>
          )}
        </span>
      </Head>
      <div className="sh-grid is-fit" style={gridCols(bundle.items.length)}>
        {bundle.items.map((c) => (
          <ShowCard
            key={c.item.code}
            item={c.item}
            className={c.owned ? 'is-owned' : ''}
            foot={
              c.owned ? (
                <span className="sh-owned sm">
                  <Icon id="i-check" />
                  Есть
                </span>
              ) : (
                <Price price={c.basePrice} />
              )
            }
          />
        ))}
      </div>
    </div>
  )
}

/** «Для тебя»: рентген-кейс — герой-карточка на полряда той же сетки, рядом четыре личные карточки. */
export function ForYou({ lead, cards, refreshAt, ...p }: { lead: ReactNode; cards: ShopCard[]; refreshAt: string } & BuyProps) {
  const shownKey = byRarity(cards)
    .map((c) => c.item.code)
    .join(',')
  useEffect(() => {
    trackImpression('shop_foryou', shownKey.split(','), 'rubies')
  }, [shownKey])
  return (
    <div className="card sh-block" data-section="shop_foryou">
      <Head title="Для тебя">
        <Timer to={refreshAt} label="Новые через" />
      </Head>
      <div className={'sh-grid' + (lead ? ' sh-foryou' : ' is-fit')} style={lead ? undefined : gridCols(cards.length)}>
        {lead ? <div className="sh-lead-bare sh-span-hero">{lead}</div> : null}
        {byRarity(cards).map((c, i) => (
          <ItemCard key={c.item.code} card={c} source="forYou" i={i} {...p} />
        ))}
      </div>
    </div>
  )
}
