import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import type { SetColorwayView, SetView } from '../../lib/rubies'
import { Dots, THEME_TONE, defaultWay } from './Sets'
import { SetShot, ShopStage } from './ShopStage'
import { warmOutfitShots } from '../../lib/outfitSnapshot'
import { Countdown, Head } from './parts'

/**
 * Наборы магазина v3 (06.10.2026, «картинка вместо слов»). Набор всегда на
 * самом игроке: живая сцена у героя и у стенда раздела, у карточек ленты —
 * снимок той же фигуры. Карточка = картинка + одна кнопка с ценой; скидка —
 * значок в углу, время — значок часов.
 */

export interface SetActs {
  balance: number
  busy: string
  /** Купить: открывает окно подтверждения. */
  onBuy: (set: SetView, way: SetColorwayView) => void
  /** Весь набор свой — надеть. */
  onWear: (set: SetView, way: SetColorwayView) => void
  /** Подписчик: рядом с ценой зачёркнута цена без скидок. */
  sub?: boolean
}

const items = (way: SetColorwayView) => way.items.map((x) => x.item)
const full = (way: SetColorwayView) => way.have >= way.items.length

/** Стрелки ленты видны, только когда туда есть что листать. */
export function useRailEdges(rail: React.RefObject<HTMLDivElement | null>, dep: unknown) {
  const [edge, setEdge] = useState({ l: false, r: false })
  useEffect(() => {
    const el = rail.current
    if (!el) return
    const upd = () => setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(upd)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', upd)
      ro?.disconnect()
    }
  }, [rail, dep])
  return edge
}

/** «−40%» в углу картинки. */
export function OffBadge({ pct }: { pct: number }) {
  if (!pct) return null
  return <span className="sv-off">−{pct}%</span>
}

/** Часы + «10ч»: только у «дня». */
export function DayClock({ to, onEnd }: { to: string; onEnd?: () => void }) {
  if (!to) return null
  return (
    <span className="sv-clock">
      <Icon id="i-clock" />
      <b>
        <Countdown to={to} onEnd={onEnd} />
      </b>
    </span>
  )
}

/** Кнопка цены: «◆1 020»; набор свой — «Надеть». */
function PriceBtn({ set, way, acts, size = 'md' }: { set: SetView; way: SetColorwayView; acts: SetActs; size?: 'md' | 'lg' }) {
  if (full(way))
    return (
      <button className={'btn ' + size + ' secondary sv-pbtn'} data-track="set_wear" onClick={(e) => (e.stopPropagation(), acts.onWear(set, way))}>
        Надеть
      </button>
    )
  return (
    <button
      className={'btn ' + size + ' primary sv-pbtn'}
      disabled={acts.busy === set.id}
      data-track="set_buy"
      onClick={(e) => (e.stopPropagation(), acts.onBuy(set, way))}
    >
      <Ruby size={size === 'lg' ? 22 : 16} />
      {way.price.toLocaleString('ru-RU')}
      {way.fullPrice > way.price ? <s className="sv-was">{way.fullPrice.toLocaleString('ru-RU')}</s> : null}
    </button>
  )
}

/** Стенд: живая фигура в наборе, имя, кружки расцветок, кнопка цены. */
function Stand({
  set,
  way,
  onPick,
  refreshAt,
  onEnd,
  on,
  hero,
  acts,
}: {
  set: SetView
  way: SetColorwayView
  onPick: (name: string) => void
  refreshAt: string
  onEnd?: () => void
  on: boolean
  hero?: boolean
  acts: SetActs
}) {
  return (
    <div className={'card sv-stand' + (hero ? ' is-hero' : '')} style={{ ['--sh-tone' as string]: THEME_TONE[set.theme] }} data-kind="set" data-id={set.id}>
      <ShopStage on={on} items={items(way)} />
      <span className="sv-corner">
        {hero ? <span className="sv-daytag">Набор дня</span> : null}
        {!full(way) ? <OffBadge pct={way.discountPct} /> : null}
        {set.ofDay ? <DayClock to={refreshAt} onEnd={onEnd} /> : null}
      </span>
      <div className="sv-stand-foot">
        <span className="sv-stand-id">
          <b className="sv-stand-name">{set.title}</b>
          <Dots set={set} way={way} onPick={onPick} size="lg" />
        </span>
        <PriceBtn set={set} way={way} acts={acts} size="lg" />
      </div>
    </div>
  )
}

/** Набор дня в первом экране. */
export function HeroSet({ set, refreshAt, onEnd, on, acts }: { set: SetView; refreshAt: string; onEnd?: () => void; on: boolean; acts: SetActs }) {
  const [name, setName] = useState<string | null>(null)
  const way = set.colorways.find((c) => c.name === name) ?? defaultWay(set)
  return <Stand set={set} way={way} onPick={setName} refreshAt={refreshAt} onEnd={onEnd} on={on} hero acts={acts} />
}

/** Карточка ленты: снимок «ты в наборе», имя, кнопка цены. Клик — стенд переодевается. */
function SetCard({ set, way, picked, onPick, acts }: { set: SetView; way: SetColorwayView; picked: boolean; onPick: () => void; acts: SetActs }) {
  return (
    <div
      role="listitem"
      className={'sh-card sv-card' + (picked ? ' on' : '')}
      style={{ ['--sh-tone' as string]: THEME_TONE[set.theme] }}
      data-kind="set"
      data-id={set.id}
    >
      <button className="sv-card-pick" aria-pressed={picked} aria-label={set.title} data-track="set_open" onClick={onPick}>
        <SetShot items={items(way)} />
        <span className="sv-corner">{!full(way) ? <OffBadge pct={way.discountPct} /> : null}</span>
      </button>
      <b className="sv-card-name">{set.title}</b>
      <PriceBtn set={set} way={way} acts={acts} />
    </div>
  )
}

/** Раздел «Наборы»: стенд слева, лента снимков справа. */
export function SetsSection({ sets, refreshAt, onEnd, on, acts }: { sets: SetView[] | null; refreshAt: string; onEnd?: () => void; on: boolean; acts: SetActs }) {
  const [pickId, setPickId] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const rail = useRef<HTMLDivElement>(null)
  const wayOf = (set: SetView) => set.colorways.find((c) => c.name === pick[set.id]) ?? defaultWay(set)
  const chosen = sets?.find((s) => s.id === pickId) ?? sets?.find((s) => s.ofDay) ?? sets?.[0] ?? null
  const scroll = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * (rail.current.clientWidth - 120), behavior: 'smooth' })
  const edge = useRailEdges(rail, sets?.length)
  // Снимки «ты в наборе»: 3D-модуль и каталог — заранее, пока игрок листает верх.
  useEffect(() => {
    if (on) warmOutfitShots()
  }, [on])
  return (
    <section id="shop-sets" className="sv-sec" data-section="sets">
      <Head title="Наборы" />
      {!sets ? (
        <div className="sv-sets" aria-hidden="true">
          <span className="skel sv-skel-stage" />
          <span className="skel sv-skel-rail" />
        </div>
      ) : !chosen ? null : (
        <div className="sv-sets">
          <Stand set={chosen} way={wayOf(chosen)} onPick={(name) => setPick((p) => ({ ...p, [chosen.id]: name }))} refreshAt={refreshAt} onEnd={onEnd} on={on} acts={acts} />
          <div className="sv-rail-wrap">
            <div className="sv-rail" ref={rail} role="list" aria-label="Наборы">
              {sets.map((set) => (
                <SetCard key={set.id} set={set} way={wayOf(set)} picked={set.id === chosen.id} onPick={() => setPickId(set.id)} acts={acts} />
              ))}
            </div>
            {edge.l ? (
              <button className="sv-rail-btn is-l" aria-label="Назад" data-track="sets_prev" onClick={() => scroll(-1)}>
                <Icon id="i-arrow-l" />
              </button>
            ) : null}
            {edge.r ? (
              <button className="sv-rail-btn is-r" aria-label="Дальше" data-track="sets_next" onClick={() => scroll(1)}>
                <Icon id="i-arrow-r" />
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
