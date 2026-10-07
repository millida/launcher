import { ShotImg } from './LoopShot'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import type { ItemRef, ShopCard, ShopDay, ShopSource } from '../../lib/rubies'
import { focusOf, outfitShot, shotAspect, type OutfitShot } from '../../lib/outfitSnapshot'
import { shopCards } from './wish'
import { ItemArt, toneStyle } from './parts'
import { RarityChip } from './rarityUi'
import { DayClock, OffBadge, useRailEdges } from './SetsV2'
import { SceneBack, usePlayerSkin } from './ShopStage'
import '../../styles/pixel/shop-motion.css'

/**
 * «Сегодня» (ТЗ v3 + решение 06.10.2026: витрина дня — крючок ежедневного
 * возврата). Вещь дня крупно, сделка дня со значком скидки, 8 вещей дня и 4
 * «для тебя» в одной сетке; часы — один раз в шапке. Ночной рынок — лишним
 * рядом, только когда идёт; «Хочу» — коротким рядом, если есть желания.
 * Плитка = картинка (вещь на теле — на самом игроке), имя, кнопка цены.
 */

/** Вещи, которые на фигуре не видно целиком: им — плоское превью. Эмоции
 *  (06.10.2026) — на фигуре и в движении, петлёй кадров (LoopShot). Питомцы
 *  в кадр снимка не попадают (ворон улетал за край) — остаются превью. */
const FLAT = new Set(['PET', 'SPRAY', 'BANNER', 'ICON'])

/** Вещь на игроке (снимок 3D), иначе плоское превью. */
export function ItemShot({ item, big, flatEffects, chip = true }: { item: ItemRef; big?: boolean; /** Эффекты — плоским превью (содержимое ящика). */ flatEffects?: boolean; /** Слово редкости внизу слева. */ chip?: boolean }) {
  const skin = usePlayerSkin()
  const ref = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)
  const flatSlot = FLAT.has(item.slot) || (!!flatEffects && item.slot === 'EFFECT')
  const [shot, setShot] = useState<OutfitShot | null | undefined>(flatSlot ? null : undefined)
  useEffect(() => {
    const el = ref.current
    if (flatSlot || !el || typeof IntersectionObserver === 'undefined') return setNear(true)
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [flatSlot])
  useEffect(() => {
    if (flatSlot || !skin || !near) return
    let alive = true
    const box = ref.current?.getBoundingClientRect()
    void outfitShot(skin.url, skin.slim, [item.code], focusOf(item.slot), shotAspect(box?.width ?? 0, box?.height ?? 0), ref.current).then((r) => alive && setShot(r))
    return () => {
      alive = false
    }
  }, [skin?.url, skin?.slim, near, item.code, flatSlot])
  const flat = shot === null || (shot && shot.dressed === 0)
  return (
    <span ref={ref} className={'sv-shot td-shot' + (flat ? ' is-flat' : '')} style={toneStyle(item)} aria-hidden="true">
      {/* Крупный план — без пола и подиума: они под ногами всего тела. */}
      <SceneBack feet={focusOf(item.slot) === 'body' ? 0.86 : 1.2} />
      {shot === undefined || flat ? <ItemArt item={item} size={big ? 'lg' : 'md'} /> : <ShotImg shot={shot!} />}
      {chip ? <RarityChip rarity={item.rarity} /> : null}
    </span>
  )
}

export interface TodayActs {
  balance: number
  busy: string
  sub: boolean
  onBuy: (card: ShopCard, source: ShopSource) => void
  onWear: (item: ItemRef) => void
}

/**
 * Карточка витрины — та же, что у наборов: картинка 3:4, −N%, слово редкости,
 * имя, кнопка цены. Вещь дня — первая, в золотой рамке.
 */
function Tile({ card, source, acts, timer, i = 0 }: { card: ShopCard; source: ShopSource; acts: TodayActs; timer?: boolean; i?: number }) {
  const buy = () => acts.onBuy(card, source)
  return (
    <div
      role="listitem"
      className={'sh-card sv-card td-card' + (source === 'featured' ? ' is-gold' : '')}
      style={{ ...toneStyle(card.item), ['--i' as string]: i }}
      data-kind="item"
      data-id={card.item.code}
      data-src={source}
    >
      <button className="sv-card-pick" aria-label={card.item.name} disabled={card.owned || acts.busy === card.item.code} data-track={'shop_pick_' + source} onClick={buy}>
        <ItemShot item={card.item} />
        <span className="sv-corner">{card.discountPct > 0 && !card.owned ? <OffBadge pct={card.discountPct} /> : null}</span>
        {timer && card.leavesAt ? (
          <span className="td-left">
            <DayClock to={card.leavesAt} />
          </span>
        ) : null}
        {source === 'forYou' ? <span className="td-you">для тебя</span> : null}
      </button>
      <b className="sv-card-name">{card.item.name}</b>
      {card.owned ? (
        <button className="btn md secondary sv-pbtn" data-track="shop_wear" onClick={() => acts.onWear(card.item)}>
          Надеть
        </button>
      ) : (
        <button className={'btn md ' + (card.price > acts.balance ? 'secondary' : 'primary') + ' sv-pbtn'} disabled={acts.busy === card.item.code} data-track={'shop_buy_' + source} onClick={buy}>
          <Ruby size={16} />
          {card.price.toLocaleString('ru-RU')}
          {card.basePrice > card.price ? <s className="sv-was">{card.basePrice.toLocaleString('ru-RU')}</s> : null}
        </button>
      )}
    </div>
  )
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Лента карточек как у наборов: один ряд, прокрутка вбок, стрелки по краям. */
function CardRail({ cards, acts, label, auto }: { cards: [ShopCard, ShopSource][]; acts: TodayActs; label: string; /** Сама листает по карточке раз в 4 с (пауза под мышью). */ auto?: boolean }) {
  const rail = useRef<HTMLDivElement>(null)
  const hold = useRef(false)
  const [live, setLive] = useState(false)
  useEffect(() => {
    const el = rail.current
    if (!auto || !el || reducedMotion()) return
    let seen = true
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((es) => setLive((seen = es.some((e) => e.isIntersecting))))
    io?.observe(el)
    const t = window.setInterval(() => {
      if (hold.current || !seen || document.hidden) return
      // Ровно к началу следующей карточки: шаг «ширина + зазор» копил
      // ошибку, и лента вставала с обрезанной карточкой слева.
      const cards = [...el.querySelectorAll<HTMLElement>('.td-card')]
      const base = cards[0]?.offsetLeft ?? 0
      const next = cards.find((c) => c.offsetLeft - base > el.scrollLeft + 4)
      if (!next || el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) el.scrollTo({ left: 0, behavior: 'smooth' })
      else el.scrollTo({ left: next.offsetLeft - base, behavior: 'smooth' })
    }, 4000)
    return () => {
      window.clearInterval(t)
      io?.disconnect()
    }
  }, [auto, cards.length])
  const scroll = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * (rail.current.clientWidth - 120), behavior: 'smooth' })
  const edge = useRailEdges(rail, cards.length)
  return (
    <div
      className={'sv-rail-wrap td-rail' + (live ? ' is-live' : '')}
      onPointerEnter={() => (hold.current = true)}
      onPointerLeave={() => (hold.current = false)}
      onFocus={() => (hold.current = true)}
      onBlur={() => (hold.current = false)}
    >
      <div className="sv-rail" ref={rail} role="list" aria-label={label}>
        {cards.map(([c, src], i) => (
          <Tile key={src + c.item.code} card={c} source={src} acts={acts} timer={auto} i={i} />
        ))}
      </div>
      {edge.l ? (
        <button className="sv-rail-btn is-l" aria-label="Назад" data-track="today_prev" onClick={() => scroll(-1)}>
          <Icon id="i-arrow-l" />
        </button>
      ) : null}
      {edge.r ? (
        <button className="sv-rail-btn is-r" aria-label="Дальше" data-track="today_next" onClick={() => scroll(1)}>
          <Icon id="i-arrow-r" />
        </button>
      ) : null}
    </div>
  )
}

export function TodaySection({ day, acts, onEnd }: { day: ShopDay; acts: TodayActs; onEnd?: () => void }) {
  const d = day.day
  const wished = new Set(day.wishlist)
  const wishes = shopCards(day).filter(([c]) => wished.has(c.item.code) && !c.owned)
  const cards: [ShopCard, ShopSource][] = [
    ...(d.featured ? [[d.featured, 'featured'] as [ShopCard, ShopSource]] : []),
    ...(d.deal ? [[d.deal, 'deal'] as [ShopCard, ShopSource]] : []),
    ...d.items.map((c) => [c, 'day'] as [ShopCard, ShopSource]),
    ...d.forYou.map((c) => [c, 'forYou'] as [ShopCard, ShopSource]),
  ]
  return (
    <>
      <section id="shop-day" className="sv-sec" data-section="today_items">
        <div className="sh-head">
          <h2>Скидки дня</h2>
          <DayClock to={d.refreshAt} onEnd={onEnd} />
        </div>
        {cards.length ? <CardRail cards={cards} acts={acts} label="Скидки дня" auto /> : null}
      </section>
      {day.nightMarket && day.nightMarket.cards.length ? (
        <section className="sv-sec" data-section="night_market">
          <div className="sh-head">
            <h2>Ночной рынок</h2>
            <DayClock to={day.nightMarket.endsAt} onEnd={onEnd} />
          </div>
          <CardRail cards={day.nightMarket.cards.map((c) => [c, 'night'])} acts={acts} label="Ночной рынок" />
        </section>
      ) : null}
      {/* «Хочу» — только когда в нём что-то есть (владелец 06.10.2026). */}
      {wishes.length ? (
        <section id="shop-wish" className="sv-sec" data-section="wishlist">
          <div className="sh-head td-wish-head">
            <h2>
              <Icon id="i-heart" />
              Хочу
            </h2>
          </div>
          <CardRail cards={wishes} acts={acts} label="Хочу" />
        </section>
      ) : null}
    </>
  )
}
