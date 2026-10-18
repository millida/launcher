import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { RARITY_NAMES, type ShopCard } from '../../lib/rubies'
import { accountCurrency, affords, balanceText, moneyText, useMoney } from '../../lib/useMoney'
import { BuyBtn, WishBtn, type BuyProps } from './Storefront'
import { gridCols, Head, ItemArt, Price, Shard, toneStyle } from './parts'
import { daysUntil, kopecksFor, sortWishes, topUpRubies, type WishEntry, type WishHow, type WishList } from './wish'
import { word } from './rarity'
import { intlTag, t, useT } from '../../i18n'

const HOW: Record<WishHow, string> = {
  get SEASON() { return t('Сезон') },
  get ACHIEVEMENT() { return t('Достижение') },
  get HOURS() { return t('Часы в игре') },
  PLUS: 'PLUS',
  get QUEST() { return t('Задание') },
}

/** Карточка из «Хочу»: вещь и одно следующее действие — купить, собрать, ждать или играть. */
function WishCard({
  w,
  shards,
  onCraft,
  ...p
}: { w: WishEntry; shards: number; onCraft: (w: WishEntry) => void } & BuyProps) {
  const t = useT()
  const it = w.item
  const card: ShopCard | null =
    w.status === 'SHOP' && w.price !== undefined
      ? { item: it, price: w.price, basePrice: w.basePrice ?? w.price, discountPct: 0, owned: false, leavesAt: w.leavesAt ?? '' }
      : null
  return (
    <div className={'sh-card sh-wcard is-' + w.status.toLowerCase()} style={toneStyle(it)}>
      {w.status !== 'OWNED' ? <WishBtn code={it.code} wishlist={p.wishlist} onWish={p.onWish} /> : null}
      {w.status === 'SHOP' ? <span className="sh-wnow">{t('В магазине')}</span> : null}
      <ItemArt item={it} />
      <b className="sh-card-name">{it.name}</b>
      <span className="sh-card-meta">
        <i>{RARITY_NAMES[it.rarity]}</i>
      </span>
      <span className="sh-card-foot">
        {card ? (
          <>
            <Price price={card.price} base={card.basePrice} />
            <BuyBtn card={card} source={w.source ?? 'day'} balance={p.balance} busy={p.busy} onBuy={p.onBuy} />
          </>
        ) : w.status === 'WORKSHOP' ? (
          <>
            <span className="sh-pr">
              <Shard size={15} />
              <b>{(w.cost ?? 0).toLocaleString(intlTag())}</b>
            </span>
            <button
              className={'btn sm ' + ((w.cost ?? 0) <= shards ? 'primary' : 'secondary')}
              disabled={p.busy === it.code}
              data-track="craft"
              data-kind="item"
              data-id={it.code}
              onClick={() => onCraft(w)}
            >
              {t('Обменять')}
            </button>
          </>
        ) : w.status === 'RETURNS' ? (
          <span className="sh-wstate">
            <Icon id="i-clock" />
            {w.returnsAt ? t('через {n} дн.', { n: daysUntil(w.returnsAt) }) : t('Вернётся')}
          </span>
        ) : w.status === 'EARN' ? (
          <span className="sh-wstate earn">
            <Icon id="i-trophy" />
            {w.how ? HOW[w.how] : t('За игру')}
          </span>
        ) : (
          <span className="sh-owned sm">
            <Icon id="i-check" />
            {t('Есть')}
          </span>
        )}
      </span>
    </div>
  )
}

/**
 * «Хочу» (правка владельца 23.09.2026, 21:45; 24.09.2026 — в самый низ ленты).
 * Шапка-строка: сумма за всё и «Докупить» ровно недостающее по базовому курсу
 * (без пакета с остатком). Ниже — ровная сетка: что можно взять сейчас — первым.
 */
export function Wishlist({
  data,
  shards,
  onTopUp,
  onCraft,
  onBrowse,
  ...p
}: {
  data: WishList | null
  shards: number
  onTopUp: (rubies: number) => void
  onCraft: (w: WishEntry) => void
  onBrowse: () => void
} & BuyProps) {
  const t = useT()
  useMoney()
  if (!data) return <span className="skel sh-skel" style={{ height: '264px' }} aria-hidden="true" />
  const items = sortWishes(data.items)
  if (!items.length)
    return (
      <div className="card sh-block sh-wempty">
        <span className="sh-wempty-art">
          <Icon id="i-heart-off" />
        </span>
        <b>{t('Пока пусто')}</b>
        <button className="btn md primary" data-track="wish_browse" onClick={onBrowse}>
          {t('К витрине')}
        </button>
      </div>
    )
  const missing = data.missing
  const kopecks = kopecksFor(topUpRubies(missing))
  const sum = accountCurrency() === 'RUB' ? moneyText(kopecks, 'RUB') : null
  const held = affords({ displayCurrency: 'RUB', priceMinor: kopecks, chargeKopecks: kopecks }) === false ? balanceText() : null
  return (
    <div className="card sh-block">
      <Head title={t('Хочу · {n}', { n: items.length })}>
        <span className="sh-head-act">
          <span className="sh-wsum">
            <Ruby size={18} />
            <b>{data.total.toLocaleString(intlTag())}</b>
            <span>{t('всё сразу')}</span>
          </span>
          {missing > 0 ? (
            <button
              className="btn md primary"
              disabled={p.busy === 'topup'}
              data-track="wish_topup"
              data-tip={t('Не хватает {n} {word}', { n: missing.toLocaleString(intlTag()), word: word(missing) }) + (held ? ' · ' + t('на кошельке {sum}', { sum: held }) : '')}
              onClick={() => onTopUp(topUpRubies(missing))}
            >
              {sum ? t('Докупить · {sum}', { sum }) : t('Докупить')}
            </button>
          ) : data.total > 0 ? (
            <span className="sh-wshort ok">
              <Icon id="i-check" />
              {t('Хватает')}
            </span>
          ) : null}
        </span>
      </Head>
      <div className="sh-grid is-fit" style={gridCols(items.length)}>
        {items.map((w) => (
          <WishCard key={w.item.code} w={w} shards={shards} onCraft={onCraft} {...p} />
        ))}
      </div>
    </div>
  )
}
