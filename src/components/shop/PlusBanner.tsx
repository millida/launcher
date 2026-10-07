import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { ChestArt } from '../daily/ChestArt'
import { PLUS_PASS } from '../daily/chestDrops'
import { DEFAULT_PLUS_OFFERS, DIAMOND_ITEM_PCT, PLUS_ITEM_PCT, type PlusEconomy, type ShopTier } from '../../lib/rubies'
import type { PlusTier } from '../../lib/gameProfile'
import { Shard } from './parts'
import { BoltArt, GemArt } from './shopArt'
import { PlusMark } from '../premium/PlusMark'
import '../../styles/pixel/plus-chip.css'

export const PLUS_CHESTS = Object.values(PLUS_PASS.chests).reduce((a, b) => a + (b || 0), 0)

export const offerOf = (plus: PlusEconomy | null, tier: 'PLUS' | 'DIAMOND') =>
  plus?.offers?.find((o) => o.tier === tier) ?? DEFAULT_PLUS_OFFERS.find((o) => o.tier === tier)!


/** Три факта значками: сундуки, скидка, осколки. Без слов-объяснений. */
export function PlusFacts({ tier = 'PLUS' }: { tier?: PlusTier }) {
  return (
    <span className="pl-facts">
      <span className="pl-fact">
        <ChestArt ready={false} tier="EPIC" size={30} />
        <b>×{PLUS_CHESTS}</b>
      </span>
      <span className="pl-fact">
        <b>−{tier === 'DIAMOND' ? DIAMOND_ITEM_PCT : PLUS_ITEM_PCT}%</b>
      </span>
      <span className="pl-fact">
        <Shard size={24} />
        <b>×{String(PLUS_PASS.shardBoost).replace('.', ',')}</b>
      </span>
    </span>
  )
}

/** Картинка подписки: корона, гигантское «◆2100» и «каждый месяц». Её же показывает окно покупки. */
export function PlusArt({ tier = 'PLUS', size = 'lg' }: { tier?: PlusTier; size?: 'lg' | 'md' }) {
  const big = size === 'lg'
  return (
    <span className={'pl-art is-' + size + (tier === 'DIAMOND' ? ' is-diamond' : '')}>
      <span className="pl-crown">
        <PlusMark tier={tier} height={big ? 64 : 50} shine />
      </span>
      <span className="pl-sum">
        <Ruby size={big ? 56 : 44} />
        <b>{PLUS_PASS.rubies.toLocaleString('ru-RU')}</b>
      </span>
      <small className="pl-month">каждый месяц</small>
    </span>
  )
}

/** Кнопка тарифа: PLUS — золото, DIAMOND — синий кристалл и молния («всё сразу»). */
export function TierBtn({ tier, label, onClick, track, size = 'lg' }: { tier: PlusTier; label: string; onClick: () => void; track: string; size?: 'md' | 'lg' }) {
  return (
    <button className={'btn ' + size + ' pl-btn ' + (tier === 'DIAMOND' ? 'is-diamond' : 'is-plus')} data-track={track} onClick={onClick}>
      {tier === 'DIAMOND' ? (
        <span className="pl-btn-ico">
          <GemArt size={22} />
          <BoltArt size={18} />
        </span>
      ) : (
        <Icon id="i-crown" />
      )}
      {label}
    </button>
  )
}

/**
 * Карточка тарифа в окне PLUS: корона (у Diamond — кристалл с молнией и
 * значок «сразу всё»), «◆2100», ценности чипами и как приходят награды.
 */
export function PlanCard({ tier }: { tier: PlusTier }) {
  const diamond = tier === 'DIAMOND'
  return (
    <span className={'pl-plan' + (diamond ? ' is-diamond' : '')}>
      {diamond ? (
        <span className="pl-now">
          <BoltArt size={16} />
          сразу всё
        </span>
      ) : null}
      <span className="pl-plan-art">
        <PlusMark tier={tier} height={diamond ? 34 : 46} shine />
      </span>
      <PlusChips tier={tier} />
      {diamond ? <b className="pl-all">+ сразу всё</b> : <small className="pl-month">награды по дням, 28 дней</small>}
    </span>
  )
}

/**
 * Всё, что даёт подписка, одной цепочкой через «+» (владелец 06.10.2026):
 * ◆2100 из пропуска + 9 сундуков + осколки ×1,5 + −10% на всё + фрагменты
 * вещей. Числа — как у службы (PLUS_PASS, PLUS_ITEM_PCT / DIAMOND_ITEM_PCT).
 */
export function PlusChips({ tier = 'PLUS' }: { tier?: PlusTier }) {
  const parts = [
    <>
      <Ruby size={20} />
      <b>{PLUS_PASS.rubies.toLocaleString('ru-RU')}</b> из пропуска
    </>,
    <>
      <ChestArt ready={false} tier="EPIC" size={22} />
      <b>{PLUS_CHESTS}</b> сундуков
    </>,
    <>
      <Shard size={18} />
      осколки <b>×{String(PLUS_PASS.shardBoost).replace('.', ',')}</b>
    </>,
    <>
      <b>−{tier === 'DIAMOND' ? DIAMOND_ITEM_PCT : PLUS_ITEM_PCT}%</b> на всё
    </>,
    <>фрагменты вещей</>,
  ]
  return (
    <span className="pl-chain">
      {parts.map((p, i) => (
        <span key={i} className="pl-link">
          {i ? <i className="pl-plus">+</i> : null}
          <span className="pl-chip">{p}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * Чип статуса подписки (владелец 06.10.2026: «маленький, красивый, желанный»):
 * высота 28px, пиксельное слово PLUS / DIAMOND с бликом и срок. Без
 * подписки — слово серое и маленький золотой «+» со свечением; клик — окно PLUS.
 */
export function PlusChip({ tier, until, onClick, track = 'plus_chip' }: { tier: ShopTier; until?: string; onClick: () => void; track?: string }) {
  const off = !tier
  return (
    <button
      className={'pc ' + (off ? 'is-off' : tier === 'DIAMOND' ? 'is-diamond' : 'is-plus')}
      aria-label={off ? 'Подключить PLUS' : tier === 'DIAMOND' ? 'Diamond' : 'PLUS'}
      data-track={track}
      onClick={onClick}
    >
      <PlusMark tier={tier === 'DIAMOND' ? 'DIAMOND' : 'PLUS'} height={14} shine={!off} />
      {off ? (
        <svg className="pc-add" viewBox="0 0 3 3" width={12} height={12} shapeRendering="crispEdges" aria-hidden="true">
          <path d="M1 0h1v3H1zM0 1h3v1H0z" />
        </svg>
      ) : until ? <small>до {until}</small> : null}
    </button>
  )
}

/** Прежняя полоса статуса над лентой убрана (владелец 06.10.2026: «большая»): статус — чипом PlusChip. */
export function PlusStatus(_: { tier: ShopTier; plus?: PlusEconomy | null; onBuy: () => void; onManage?: () => void }) {
  return null
}
