import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { cosmeticSlotIcon } from '../../lib/cosmeticSlots'
import { useVariantPreview } from '../../lib/variantArt'
import type { ItemRef, SetColorwayView, SetTheme, SetView } from '../../lib/rubies'
import { Head, ItemArt, Price, Timer, toneStyle } from './parts'
import { RarityFx, RarityPlate } from './rarityUi'
import { RARITY_ORDER, rarityRank, swatch } from './rarity'

/**
 * Наборы (02.10.2026): готовый образ из вещей одной темы со скидкой.
 * Карточка — коллаж из самых дорогих вещей, кружки расцветок, ряд мини-значков
 * всех вещей, цена. Клик — окно набора: каждая вещь плиткой, «Купить» и
 * «Примерить». Цены и «есть» приходят от службы по каждой расцветке.
 */

export const THEME_TITLE: Record<SetTheme, string> = { flame: 'Пламя', dark: 'Тьма', future: 'Будущее', cozy: 'Уют' }
export const THEME_ORDER: SetTheme[] = ['flame', 'dark', 'future', 'cozy']
/** Цвет темы: токены редкости, без своих оттенков. */
export const THEME_TONE: Record<SetTheme, string> = {
  flame: 'var(--m-rarity-mythic)',
  dark: 'var(--m-rarity-epic)',
  future: 'var(--m-rarity-rare)',
  cozy: 'var(--m-rarity-uncommon)',
}

/** Превью вещи без подложки: перекрашено в свою расцветку, без картинки — значок слота. */
export function PxThumb({ item, className = '' }: { item: ItemRef; className?: string }) {
  const [broken, setBroken] = useState(false)
  const src = useVariantPreview(item.preview, item.tintFrom, item.tintFrom ? item.color : null)
  return (
    <span className={'px-thumb ' + className}>
      {item.preview && !src && !broken ? null : src && !broken ? (
        <img src={src} alt="" draggable={false} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <Icon id={cosmeticSlotIcon(item.slot)} />
      )}
    </span>
  )
}

/** Расцветка, которую показываем сразу: где у игрока больше всего вещей, иначе первая. */
export const defaultWay = (set: SetView): SetColorwayView =>
  set.colorways.reduce((best, way) => (way.have > best.have ? way : best), set.colorways[0]!)

/** Самые дорогие вещи расцветки: их показывает коллаж. */
export const topItems = (way: SetColorwayView, n: number) =>
  [...way.items].sort((a, b) => b.price - a.price || rarityRank(b.item.rarity) - rarityRank(a.item.rarity)).slice(0, n).map((x) => x.item)

export const thingWord = (n: number): string => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'вещь'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'вещи'
  return 'вещей'
}

export function SetCollage({ items, big }: { items: ItemRef[]; big?: boolean }) {
  return (
    <span className={'st-col' + (big ? ' big' : '')} style={{ ['--n' as string]: items.length }} aria-hidden="true">
      {items.map((it, i) => (
        <span key={it.code} className="st-col-i" style={{ ...toneStyle(it), ['--i' as string]: i }}>
          <PxThumb item={it} />
        </span>
      ))}
    </span>
  )
}

/** Кружки расцветок: переключают превью и цену. */
export function Dots({ set, way, onPick, size = 'md' }: { set: SetView; way: SetColorwayView; onPick: (name: string) => void; size?: 'md' | 'lg' }) {
  if (set.colorways.length < 2) return null
  return (
    <span className={'st-dots ' + size} role="radiogroup" aria-label="Расцветка">
      {set.colorways.map((c) => (
        <button
          key={c.name}
          role="radio"
          aria-checked={c.name === way.name}
          aria-label={c.name}
          className={'st-dot' + (c.name === way.name ? ' on' : '')}
          style={{ ['--dot' as string]: swatch(c.color) }}
          data-track="set_colorway"
          onClick={(e) => {
            e.stopPropagation()
            onPick(c.name)
          }}
        />
      ))}
    </span>
  )
}

/** Ряд мини-значков всех вещей набора; свои приглушены. */
function Minis({ way }: { way: SetColorwayView }) {
  return (
    <span className="st-minis" aria-hidden="true">
      {way.items.map((x) => (
        <span key={x.item.code} className={'st-mini' + (x.owned ? ' is-own' : '')} style={toneStyle(x.item)}>
          <PxThumb item={x.item} />
        </span>
      ))}
    </span>
  )
}

export function DayTag({ pct }: { pct: number }) {
  return <span className="st-day">Набор дня −{pct}%</span>
}

export interface SetActions {
  balance: number
  busy: string
  onBuy: (set: SetView, way: SetColorwayView) => void
  onTry: (set: SetView, way: SetColorwayView) => void
  onWear: (set: SetView, way: SetColorwayView) => void
}

function SetCard({ set, way, onPick, onOpen, ...a }: { set: SetView; way: SetColorwayView; onPick: (name: string) => void; onOpen: () => void } & SetActions) {
  const n = way.items.length
  const full = way.have >= n
  const part = way.have > 0 && !full
  return (
    <div
      className={'sh-card st-card' + (full ? ' is-full' : '')}
      style={{ ['--sh-tone' as string]: THEME_TONE[set.theme] }}
      role="button"
      tabIndex={0}
      data-kind="set"
      data-id={set.id}
      data-track="set_open"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {set.ofDay ? <DayTag pct={way.discountPct} /> : !full && way.discountPct ? <span className="sh-off">−{way.discountPct}%</span> : null}
      <SetCollage items={topItems(way, 4)} />
      <b className="sh-card-name st-name">{set.title}</b>
      <span className="st-line">
        <Minis way={way} />
        <Dots set={set} way={way} onPick={onPick} />
      </span>
      <span className="st-have">{full ? 'Твой' : part ? 'есть ' + way.have + ' из ' + n : n + ' ' + thingWord(n)}</span>
      <span className="sh-card-foot st-foot" onClick={(e) => e.stopPropagation()}>
        {full ? (
          <button className="btn sm primary" data-track="set_wear" onClick={() => a.onWear(set, way)}>
            Надеть
          </button>
        ) : (
          <>
            <Price price={way.price} base={way.fullPrice} />
            <button
              className={'btn sm ' + (way.price > a.balance ? 'secondary' : 'primary')}
              disabled={a.busy === set.id}
              data-track="set_buy"
              onClick={() => a.onBuy(set, way)}
            >
              Купить
            </button>
          </>
        )}
      </span>
    </div>
  )
}

/** Набор дня крупно: для вкладки «Сегодня». */
export function SetHero({
  set,
  refreshAt,
  onOpen,
  onEnd,
  ...a
}: { set: SetView; refreshAt: string; onOpen: (set: SetView, way: SetColorwayView) => void; onEnd?: () => void } & SetActions) {
  const [name, setName] = useState<string | null>(null)
  const way = set.colorways.find((c) => c.name === name) ?? defaultWay(set)
  const full = way.have >= way.items.length
  return (
    <div className="card sh-block st-hero" style={{ ['--sh-tone' as string]: THEME_TONE[set.theme] }} data-section="set_of_day" data-kind="set" data-id={set.id}>
      <button className="st-hero-art" data-track="set_open" aria-label={set.title} onClick={() => onOpen(set, way)}>
        <SetCollage items={topItems(way, 4)} big />
      </button>
      <div className="st-hero-body">
        <span className="st-hero-top">
          <DayTag pct={way.discountPct} />
          <Timer to={refreshAt} onEnd={onEnd} />
        </span>
        <h2 className="st-hero-name">{set.title}</h2>
        <span className="st-line">
          <Minis way={way} />
          <Dots set={set} way={way} onPick={setName} size="lg" />
        </span>
        <span className="st-hero-buy">
          {full ? (
            <button className="btn md primary" data-track="set_wear" onClick={() => a.onWear(set, way)}>
              Надеть
            </button>
          ) : (
            <>
              <Price price={way.price} base={way.fullPrice} big />
              <button className={'btn md ' + (way.price > a.balance ? 'secondary' : 'primary')} disabled={a.busy === set.id} data-track="set_buy" onClick={() => a.onBuy(set, way)}>
                Купить
              </button>
              <button className="btn md secondary" data-track="set_try" onClick={() => a.onTry(set, way)}>
                Примерить
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/** Вкладка «Наборы»: сетка карточек, набор дня первым, дальше заголовки тем. */
export function SetsTab({ sets, refreshAt, onEnd, ...a }: { sets: SetView[] | null; refreshAt: string; onEnd?: () => void } & SetActions) {
  const [pick, setPick] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const wayOf = (set: SetView) => set.colorways.find((c) => c.name === pick[set.id]) ?? defaultWay(set)
  const groups = useMemo(
    () => THEME_ORDER.map((theme) => ({ theme, list: (sets ?? []).filter((s) => s.theme === theme && !s.ofDay) })).filter((g) => g.list.length),
    [sets],
  )
  const day = sets?.find((s) => s.ofDay) ?? null
  const opened = sets?.find((s) => s.id === open) ?? null

  if (!sets)
    return (
      <div className="st-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="skel st-skel" />
        ))}
      </div>
    )

  if (!sets.length)
    return (
      <div className="st-empty">
        <b>Наборов пока нет</b>
      </div>
    )

  const card = (set: SetView) => (
    <SetCard key={set.id} set={set} way={wayOf(set)} onPick={(name) => setPick((p) => ({ ...p, [set.id]: name }))} onOpen={() => setOpen(set.id)} {...a} />
  )
  return (
    <div className="st-tab">
      {day ? <SetHero set={day} refreshAt={refreshAt} onOpen={(st) => setOpen(st.id)} onEnd={onEnd} {...a} /> : null}
      {groups.map((g) => (
        <section key={g.theme} className="st-sec" data-theme={g.theme}>
          <Head title={THEME_TITLE[g.theme]} />
          <div className="st-grid">{g.list.map(card)}</div>
        </section>
      ))}
      {opened ? (
        <SetModal
          set={opened}
          way={wayOf(opened)}
          onPick={(name) => setPick((p) => ({ ...p, [opened.id]: name }))}
          onClose={() => setOpen(null)}
          refreshAt={refreshAt}
          {...a}
          onBuy={(st, w) => (setOpen(null), a.onBuy(st, w))}
          onTry={(st, w) => (setOpen(null), a.onTry(st, w))}
          onWear={(st, w) => (setOpen(null), a.onWear(st, w))}
        />
      ) : null}
    </div>
  )
}

/** Окно набора: вещи плитками с ценой каждой, «Купить» и «Примерить». */
export function SetModal({
  set,
  way,
  onPick,
  onClose,
  refreshAt,
  ...a
}: { set: SetView; way: SetColorwayView; onPick: (name: string) => void; onClose: () => void; refreshAt: string } & SetActions) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const full = way.have >= way.items.length
  const items = [...way.items].sort((x, y) => RARITY_ORDER.indexOf(y.item.rarity) - RARITY_ORDER.indexOf(x.item.rarity) || y.price - x.price)
  return createPortal(
    <div className="modal-bg open vis st-bg" onClick={onClose}>
      <div className="modal mw-xl st-modal" style={{ ['--sh-tone' as string]: THEME_TONE[set.theme] }} role="dialog" aria-label={set.title} onClick={(e) => e.stopPropagation()}>
        <button className="st-x btn sm ghost" aria-label="Закрыть" data-track="set_close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
        <div className="st-m-head">
          <h3>{set.title}</h3>
          {set.ofDay ? <DayTag pct={way.discountPct} /> : null}
          {set.ofDay ? <Timer to={refreshAt} /> : null}
          <Dots set={set} way={way} onPick={onPick} size="lg" />
        </div>
        <div className="st-m-grid">
          {items.map((x) => (
            <div key={x.item.code} className={'sh-card is-show st-tile' + (x.owned ? ' is-owned' : '')} style={toneStyle(x.item)} data-rar={x.item.rarity}>
              <RarityFx />
              <ItemArt item={x.item} />
              <b className="sh-card-name">{x.item.name}</b>
              <span className="sh-card-meta">
                <RarityPlate rarity={x.item.rarity} small />
              </span>
              <span className="sh-card-foot">
                {x.owned ? (
                  <span className="sh-owned sm">
                    <Icon id="i-check" />
                    Есть
                  </span>
                ) : (
                  <Price price={x.price} />
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="st-m-foot">
          {full ? (
            <>
              <span className="st-have big">Твой</span>
              <button className="btn md primary" data-track="set_wear" onClick={() => a.onWear(set, way)}>
                Надеть
              </button>
            </>
          ) : (
            <>
              <Price price={way.price} base={way.fullPrice} big />
              {way.discountPct ? <span className="sh-off inline">−{way.discountPct}%</span> : null}
              <button className={'btn md ' + (way.price > a.balance ? 'secondary' : 'primary')} disabled={a.busy === set.id} data-track="set_buy" onClick={() => a.onBuy(set, way)}>
                Купить
              </button>
              <button className="btn md secondary" data-track="set_try" onClick={() => a.onTry(set, way)}>
                Примерить
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
