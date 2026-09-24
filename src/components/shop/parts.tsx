import { useVariantPreview } from '../../lib/variantArt'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { cosmeticSlotIcon } from '../../lib/cosmeticSlots'
import type { ItemRef } from '../../lib/rubies'
import { RARITY_TONE } from './rarity'

/**
 * Осколок — вторая валюта. Рисунок, а не значок: как рубин, это предмет,
 * который игрок копит. Кристалл из ромбов, без сглаживания контура.
 *
 * Тёмная ступенчатая обводка в одну клетку (правка владельца 23.09.2026:
 * «у осколка нет тени — сливается с зелёным»): тот же силуэт, сдвинутый на
 * клетку в четыре стороны, под кристаллом, плюс жёсткая тень на клетку ниже.
 * Читается на зелёном, фиолетовом и тёмном фоне одинаково.
 */
const SHARD_PATH = 'M8 0h2v2h2v4h2v4h-2v4h-2v2H8v-2H6v-4H4V6h2V2h2z'
export function Shard({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-1 -1 18 19" className="sh-shard" aria-hidden="true" shapeRendering="crispEdges">
      <path d={SHARD_PATH} fill="#071322" transform="translate(0 2)" opacity="0.55" />
      {[
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ].map(([x, y]) => (
        <path key={x + ':' + y} d={SHARD_PATH} fill="#071322" transform={'translate(' + x + ' ' + y + ')'} />
      ))}
      <path d={SHARD_PATH} fill="var(--m-rarity-rare)" />
      <path d="M8 2h2v4h2v4h-2V6H8z" fill="#bfe6ff" />
      <path d="M6 10h2v4H6z" fill="rgba(0,0,0,.28)" />
    </svg>
  )
}

/** «до 24 сентября» по Москве: смена дня магазина — 00:00 МСК. */
export function untilLabel(iso: string): string {
  return 'до ' + new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
}

/** Сколько целых часов осталось (минимум 1): для спокойной строки «через 3 ч». */
export function hoursLeft(iso: string): number {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 3_600_000))
}

/* ── Таймеры ───────────────────────────────────────────────────────────────
 * Правка владельца 23.09.2026: «нет таймеров — надо таймеры». Модель экономики
 * запрещала отсчёт как давление; здесь отсчёт спокойный: серый, без секунд и
 * без красного, обновляется раз в 20 секунд. Одни часы на весь экран. */

const listeners = new Set<(now: number) => void>()
let tick = 0
function subscribeNow(fn: (now: number) => void) {
  listeners.add(fn)
  if (!tick) tick = window.setInterval(() => listeners.forEach((l) => l(Date.now())), 20_000)
  return () => {
    listeners.delete(fn)
    if (!listeners.size) {
      window.clearInterval(tick)
      tick = 0
    }
  }
}

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => subscribeNow(setNow), [])
  return now
}

/** «2д 14ч», «5ч 12м», «12 мин», «меньше минуты». */
export function leftLabel(ms: number): string {
  if (ms <= 60_000) return 'меньше минуты'
  const min = Math.floor(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return d + 'д ' + h + 'ч'
  if (h > 0) return h + 'ч ' + String(m).padStart(2, '0') + 'м'
  return m + ' мин'
}

/** Живой отсчёт до `to`. Дошёл до нуля — один раз зовёт `onEnd` (обновить витрину). */
export function Countdown({ to, onEnd }: { to: string; onEnd?: () => void }) {
  const now = useNow()
  const left = new Date(to).getTime() - now
  const fired = useRef(false)
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true
      onEnd?.()
    }
  }, [left <= 0])
  return <>{leftLabel(Math.max(0, left))}</>
}

/** Плашка-таймер: часы, подпись, время. Спокойная, без красного. */
export function Timer({ to, label, big, onEnd }: { to: string; label?: string; big?: boolean; onEnd?: () => void }) {
  return (
    <span className={'sh-tag sh-timer' + (big ? ' big' : '')}>
      <Icon id="i-clock" />
      {label ? <span>{label}</span> : null}
      <b>
        <Countdown to={to} onEnd={onEnd} />
      </b>
    </span>
  )
}

/** Ступеней в анимации скидки: цена «щёлкает» вниз, как счётчик в игре. */
const DROP_STEPS = 6
const DROP_MS = 90

/**
 * Скидка — ступенями (рецепт «сока», docs/DESIGN-JUICE.md): сначала видна
 * полная цена, её перечёркивает линия, и число щёлкает вниз до цены со
 * скидкой за 6 шагов. Один раз при появлении; reduced-motion — сразу итог.
 */
function useStepDown(from: number, to: number): number {
  const [shown, setShown] = useState(from > to ? from : to)
  useEffect(() => {
    if (!(from > to) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setShown(to)
    let k = 0
    setShown(from)
    const id = window.setInterval(() => {
      k++
      setShown(k >= DROP_STEPS ? to : Math.round((from - ((from - to) * k) / DROP_STEPS) / 10) * 10)
      if (k >= DROP_STEPS) window.clearInterval(id)
    }, DROP_MS)
    return () => window.clearInterval(id)
  }, [from, to])
  return shown
}

/** Цена в рубинах; при скидке старая зачёркнута рядом, новая «щёлкает» вниз. */
export function Price({ price, base, big }: { price: number; base?: number; big?: boolean }) {
  const off = !!base && base > price
  const shown = useStepDown(off ? base! : price, price)
  return (
    <span className={'sh-pr' + (big ? ' big' : '') + (off ? ' is-off' : '')}>
      <Ruby size={big ? 20 : 15} />
      <b>{shown.toLocaleString('ru-RU')}</b>
      {off ? <s>{base!.toLocaleString('ru-RU')}</s> : null}
    </span>
  )
}

/** Превью вещи на подложке цвета редкости. */
export function ItemArt({ item, size = 'md' }: { item: ItemRef; size?: 'sm' | 'md' | 'lg' }) {
  // У части вещей превью на CDN ещё нет (замер 23.09.2026: плащ из линии часов
  // отдал 404) — вместо битой картинки значок слота.
  const [broken, setBroken] = useState(false)
  // Мерцание редкости: у эпических и легендарных в превью вспыхивают
  // пиксели-искры (steps, без свечения) — видно издалека, что вещь особая.
  const rare = item.rarity === 'EPIC' || item.rarity === 'LEGENDARY' || item.rarity === 'MYTHIC'
  // Вещь-расцветка (v3.1): превью перекрашено в свою расцветку.
  const src = useVariantPreview(item.preview, item.tintFrom, item.tintFrom ? item.color : null)
  return (
    <span className={'sh-art ' + size} style={toneStyle(item)}>
      {rare ? (
        <>
          <i className="sh-tw t1" aria-hidden="true" />
          <i className="sh-tw t2" aria-hidden="true" />
          <i className="sh-tw t3" aria-hidden="true" />
        </>
      ) : null}
      {item.preview && !src && !broken ? null : src && !broken ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <Icon id={cosmeticSlotIcon(item.slot)} />
      )}
    </span>
  )
}

/** Цвет редкости для карточки: --sh-tone читает магазин, --rar — слой эффекта (rarity.css). */
export const toneStyle = (item: ItemRef): CSSProperties => ({
  ['--sh-tone' as string]: RARITY_TONE[item.rarity],
  ['--rar' as string]: RARITY_TONE[item.rarity],
})

/**
 * Шапка блока: заголовок, справа — строка-факт или действие. Без значка:
 * значки у заголовков владелец убрал 23.09.2026 («Ночной рынок, витрина —
 * иконки вообще нельзя»).
 */
export function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="sh-head">
      <h2>{title}</h2>
      {children}
    </div>
  )
}

/* ── Ровная сетка магазина ─────────────────────────────────────────────────
 * Правка владельца 23.09.2026: «витрина дня в две строки — некрасиво; все
 * карточки одного размера, 4 или 8 в ряд». Сетка одна на весь магазин:
 * 8 колонок, у́же — 4, совсем узко — 2 (container query в shop.css). Каждая
 * карточка — ровно одна клетка одной высоты. Чтобы ряд не рвался, у блока
 * есть «ведущая» плитка (заголовок, таймер, цена, кнопка), которая занимает
 * ровно столько клеток, сколько не хватает до полного ряда. */

const spanFor = (n: number, cols: number) => (n % cols === 0 ? cols : cols - (n % cols))
/** Ширина ведущей плитки при 8, 4 и 2 колонках для блока из `n` карточек. */
export const leadSpans = (n: number): CSSProperties => ({
  ['--l8' as string]: spanFor(n, 8),
  ['--l4' as string]: spanFor(n, 4),
  ['--l2' as string]: spanFor(n, 2),
})

/** Классы ширины ведущей плитки: `l4-1` — при 4 колонках она в одну клетку (тогда раскладка столбиком). */
export const leadCls = (n: number): string => 'l8-' + spanFor(n, 8) + ' l4-' + spanFor(n, 4) + ' l2-' + spanFor(n, 2)

/* ── Сетка секции (правка владельца 24.09.2026) ────────────────────────────
 * «Баннер на полстроки, потом целая строчка — не очень». Теперь у секции
 * шапка-строка (заголовок + таймер/баланс справа), под ней — ровная сетка
 * одинаковых карточек без ведущей плитки. Колонок столько, чтобы ряды были
 * полными: 12 вещей — 6 в ряд, 5 пакетов — 5, 4 вещи набора — 4. У́же —
 * 4 и 2 колонки (container query в shop.css). */

/** Лучшее число колонок от 4 до 8: меньше всего пустых клеток, при равенстве — шире. */
export function bestCols(n: number, max = 8, min = 4): number {
  if (n <= min) return Math.max(1, n)
  if (n <= max) return n
  let best = max
  let waste = Infinity
  for (let c = max; c >= min; c--) {
    const w = Math.ceil(n / c) * c - n
    if (w < waste) {
      waste = w
      best = c
    }
  }
  return best
}

/** Колонки сетки секции из `n` одинаковых карточек при широком, среднем и узком окне. */
export const gridCols = (n: number): CSSProperties => ({
  ['--c8' as string]: bestCols(n),
  ['--c4' as string]: n <= 5 ? Math.max(1, n) : bestCols(n, 4, 3),
  ['--c2' as string]: Math.min(2, Math.max(1, n)),
})

/** Хвост ряда без ведущей плитки: пустые клетки занимает таймер обновления. */
export function RowFill({ n, children }: { n: number; children: ReactNode }) {
  const f = (cols: number) => (cols - (n % cols)) % cols
  return (
    <div
      className={'sh-card sh-fill f8-' + f(8) + ' f4-' + f(4) + ' f2-' + f(2)}
      style={{ ['--f8' as string]: f(8) || 1, ['--f4' as string]: f(4) || 1, ['--f2' as string]: f(2) || 1 }}
    >
      {children}
    </div>
  )
}
