import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { PlusMark } from '../premium/PlusMark'
import { FestiveSnow } from '../festive/FestiveLayer'
import './adventArt'
import type { DailySeason } from '../../lib/rubies'
import { useLiteMode } from '../../lib/liteMode'
import { hasMillidaAccount } from '../../lib/api'
import { ADVENT_DAYS, adventChain, adventDate, adventWeekend } from './advent'
import { timerText, type CellState, type PassCol, type Row } from './track'
import { useFlights } from './SeasonPass'
import { useRail } from './useRail'
import { rarityTone, rewardLabel, rewardTitle, RewardArt } from './rewards'
import '../../styles/pixel/pass.css'
import '../../styles/pixel/festive.css'
import '../../styles/pixel/advent.css'
import { intlTag, useT } from '../../i18n'
import { plusPrice, useMoney } from '../../lib/useMoney'

/**
 * Новогодний календарь (декабрь 2026): 31 клетка, по одной на день, строки
 * обычная и PLUS — та же лента, что у пропуска (SeasonPass.tsx), но в клетках
 * крышки: номер дня и новогодний рисунок, у PLUS — золотая обёртка с бантом.
 * Что под крышкой, клиент узнаёт только из ответа «Забрать»: крышка снимается,
 * награда подпрыгивает и летит в баланс или в «Мои сундуки». Без анимации
 * («меньше движения», лёгкий режим) — награда сразу. Оформление — новогодняя
 * тема лаунчера внутри блока (.fx-scope, снег FestiveLayer, гирлянда).
 * Правила дня и сгоревших клеток — advent.ts.
 */

/** Рисунки крышек: обычная строка и PLUS — свои наборы, по кругу от номера дня. */
const FREE_ART = ['fir', 'snowflake', 'mitten', 'candy', 'snowman', 'stocking', 'ornament', 'bell']
const PLUS_ART = ['star', 'crown', 'gem', 'bell', 'ornament', 'gift']
/** Бумага обычных крышек: красная, зелёная, синяя по очереди. */
const PAPER = ['red', 'green', 'blue']

/** Сколько длится снятие крышки до полёта награды, мс (совпадает с av-lid-off в advent.css). */
const LID_MS = 620

const REDUCE = '(prefers-reduced-motion: reduce)'
const subscribeReduce = (cb: () => void) => {
  const mq = window.matchMedia?.(REDUCE)
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}
const reduceNow = () => !!window.matchMedia?.(REDUCE).matches

/** Анимации крышек можно: не «меньше движения» и не слабый ПК. */
function useMotion(): boolean {
  const lite = useLiteMode()
  const reduced = useSyncExternalStore(subscribeReduce, reduceNow, () => false)
  return !lite && !reduced
}

const cellKey = (day: number, row: Row) => row + ':' + day

function Door({
  col,
  row,
  state,
  last,
  intact,
  soon,
  opening,
  onOpen,
  onLocked,
}: {
  col: PassCol
  row: Row
  state: CellState
  last: boolean
  /** Цепочка строки к 31-й цела. */
  intact: boolean
  soon: string | null
  /** Крышку только что сняли: играет анимация. */
  opening: boolean
  onOpen: (el: HTMLElement) => void
  onLocked: () => void
}) {
  const t = useT()
  const list = row === 'free' ? col.free : col.plus
  const open = state === 'claimed' && list.length > 0
  const art = last ? 'star' : (row === 'plus' ? PLUS_ART : FREE_ART)[(col.n - 1) % (row === 'plus' ? PLUS_ART : FREE_ART).length]!
  const paper = row === 'plus' ? 'gold' : PAPER[(col.n - 1) % PAPER.length]
  const size = row === 'plus' ? (last ? 120 : 104) : last ? 84 : 68
  const title = open ? list.map(rewardTitle).join(', ') : t('подарок-сюрприз')
  const what = row === 'plus' ? t('PLUS, день {n}: {title}', { n: col.n, title }) : t('день {n}: {title}', { n: col.n, title })
  const style = open && list[0] ? ({ '--ra-tone': rarityTone(list[0]) } as CSSProperties) : undefined
  const cls = 'bp-card av-door ' + row + ' ' + state + (last ? ' last' : '') + (opening ? ' opening' : '')

  const tag =
    state === 'ready' ? (
      <b className="bp-take">{t('Открыть')}</b>
    ) : open ? (
      <b className={'bp-tag' + (list.length > 1 ? ' many' : '')}>{list.map(rewardLabel).join(' + ')}</b>
    ) : state === 'missed' ? (
      <b className="bp-tag av-gone">{last ? t('Не все 30 дней') : t('Сгорела')}</b>
    ) : soon ? (
      <b className="bp-tag soon">
        <Icon id="i-clock" />
        {soon}
      </b>
    ) : last ? (
      <b className="bp-tag av-hint">{intact ? t('Забери все 30 дней') : t('Не все 30 дней')}</b>
    ) : null

  const inner = (
    <>
      {open ? (
        <span className="bp-art av-prize">
          {list.map((r, i) => (
            <RewardArt key={i} reward={r} size={list.length > 1 ? size - 40 : size} />
          ))}
        </span>
      ) : null}
      {!open || opening ? (
        <span className={'av-lid paper-' + paper + (opening && open ? ' off' : '')} aria-hidden="true">
          {row === 'plus' ? <i className="av-ribbon" /> : null}
          {last ? <b className="av-kick">{t('Эксклюзив')}</b> : null}
          <PxIcon name={art} size={row === 'plus' ? 48 : 36} className="px-icon av-pic" />
          <b className="av-num">{col.n}</b>
        </span>
      ) : null}
      {opening && open ? <i className="av-burst" aria-hidden="true" /> : null}
      {tag}
      {state === 'locked' ? (
        <span className="bp-mark lock">
          <Icon id="i-crown" />
        </span>
      ) : state === 'claimed' ? (
        <span className="bp-mark got">
          <Icon id="i-check" />
        </span>
      ) : null}
    </>
  )
  const slot = 'bp-slot ' + row + ' ' + state + (last ? ' last' : '')
  if (state === 'ready' || state === 'locked') {
    return (
      <span className={slot}>
        <button
          type="button"
          className={cls}
          style={style}
          aria-label={state === 'ready' ? t('Открыть подарок — {what}', { what }) : t('Только с PLUS — {what}', { what })}
          data-track={state === 'ready' ? 'advent_open' : 'advent_locked'}
          data-kind="advent_cell"
          data-id={cellKey(col.n, row)}
          onClick={(e) => (state === 'ready' ? onOpen(e.currentTarget) : onLocked())}
        >
          {inner}
        </button>
      </span>
    )
  }
  return (
    <span className={slot}>
      <span className={cls} style={style} aria-label={state === 'missed' ? t('{what}, день пропущен', { what }) : what} data-id={cellKey(col.n, row)}>
        {inner}
      </span>
    </span>
  )
}

/** Зимняя ночь: небо, звёзды, луна, ели на сугробах; снег и гирлянда — из новогодней темы. */
function WinterScene() {
  return (
    <span className="bp-scene av-scene" aria-hidden="true">
      <i className="av-stars" />
      <PxIcon name="moon" size={72} className="px-icon av-moon" />
      <span className="av-firs">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <PxIcon key={i} name="fir" size={i % 2 ? 96 : 132} className={'px-icon av-fir f' + i} />
        ))}
      </span>
      <i className="av-hills" />
      <FestiveSnow />
      <i className="fx-garland av-garland" />
    </span>
  )
}

export default function AdventCalendar({
  cols,
  own,
  left,
  busy,
  season,
  price,
  compact,
  extra,
  onClaim,
  onPlus,
  onClose,
  below,
}: {
  cols: PassCol[]
  own: boolean
  /** Мс до открытия следующей клетки. */
  left: number
  busy: boolean
  season: DailySeason | null
  /** Цена PLUS в копейках (0 — не показывать). */
  price: number
  compact?: boolean
  extra?: { busy: boolean; onClaim: () => void } | null
  onClaim: (day: number, row: Row) => void
  onPlus: () => void
  onClose?: () => void
  below?: ReactNode
}) {
  const t = useT()
  useMoney()
  const motion = useMotion()
  const { launch, layer } = useFlights()
  const [opening, setOpening] = useState<string[]>([])
  const pending = useRef<{ day: number; row: Row }[]>([])

  const today = season?.day ?? 0
  const todayCol = cols.find((c) => c.n === today)
  const focusN = todayCol?.n ?? cols.find((c) => c.freeState === 'future')?.n ?? cols[cols.length - 1]?.n
  const { ref, edge, page } = useRail(focusN, 3 * (compact ? 136 : 152), '.bp-col.focus')
  const ready = cols.flatMap((c) => [
    ...(c.freeState === 'ready' ? [{ day: c.n, row: 'free' as Row }] : []),
    ...(c.plusState === 'ready' ? [{ day: c.n, row: 'plus' as Row }] : []),
  ])
  const free = adventChain(cols, 'free')
  const plus = adventChain(cols, 'plus')
  const got = cols.filter((c) => c.freeState === 'claimed').length
  const nextN = cols.find((c) => c.freeState === 'future')?.n ?? 0
  const can = ready.length > 0 || !!extra
  const end = season?.endsAt ? new Date(Date.parse(season.endsAt) - 1) : null
  const endText = end && Number.isFinite(end.getTime()) ? end.toLocaleDateString(intlTag(), { day: 'numeric', month: 'long' }) : ''

  // Ответ «Забрать» пришёл: клетка забрана и показывает награду. Крышка
  // снимается, после неё награда летит в баланс. Отказ службы — крышка на месте.
  useEffect(() => {
    if (!pending.current.length) return
    const stateOf = (p: { day: number; row: Row }) => {
      const c = cols.find((x) => x.n === p.day)
      return c ? (p.row === 'free' ? c.freeState : c.plusState) : undefined
    }
    const done = pending.current.filter((p) => stateOf(p) === 'claimed' || !busy)
    if (!done.length) return
    pending.current = pending.current.filter((p) => !done.includes(p))
    const keys = done.map((p) => cellKey(p.day, p.row))
    const close = () => setOpening((o) => o.filter((k) => !keys.includes(k)))
    const opened = done.filter((p) => stateOf(p) === 'claimed')
    if (!motion || !opened.length) return close()
    // Без отмены при перерисовке: иначе свежий ответ службы оборвал бы снятие крышки.
    window.setTimeout(() => {
      const root = ref.current
      launch(
        opened.flatMap((p) => {
          const c = cols.find((x) => x.n === p.day)
          const reward = c ? (p.row === 'free' ? c.free : c.plus)[0] : undefined
          const el = root?.querySelector<HTMLElement>('[data-id="' + cellKey(p.day, p.row) + '"]') ?? null
          return reward ? [{ el, reward }] : []
        }),
      )
      close()
    }, LID_MS)
  }, [cols, busy, motion])

  const start = (cells: { day: number; row: Row }[]) => {
    pending.current = [...pending.current, ...cells]
    if (motion) setOpening((o) => [...o, ...cells.map((c) => cellKey(c.day, c.row))])
  }
  const openCell = (day: number, row: Row) => {
    if (busy) return
    // Без входа claim только зовёт вход и выходит до busy: ответа, что снял бы крышку,
    // не будет, и клетка дрожала бы без конца. Крышку не трогаем.
    if (!hasMillidaAccount()) return onClaim(day, row)
    start([{ day, row }])
    onClaim(day, row)
  }
  const openToday = () => {
    if (busy) return
    if (!ready.length) return extra?.onClaim()
    // Сегодня открыта одна клетка на строку: забираем по очереди, начиная с обычной.
    const first = ready[0]!
    openCell(first.day, first.row)
  }

  return (
    <div className={'bp av fx-scope' + (compact ? ' compact' : '') + (own ? ' own' : '')}>
      <div className="bp-stage av-stage">
        <WinterScene />
        <div className="bp-main">
          <div className="bp-hero">
            <div className="bp-hero-main">
              <span className="bp-kicker">
                {t('Декабрь')}
                {endText ? <i>{t('до {date}', { date: endText })}</i> : null}
              </span>
              <h2 className="bp-title">{t('Новогодний календарь')}</h2>
              <div className="bp-progress" aria-label={t('Забрано дней: {n} из {total}', { n: got, total: ADVENT_DAYS })}>
                <b className="bp-progress-n">
                  {got}
                  <small>/{ADVENT_DAYS}</small>
                </b>
                <span className="bp-bar" style={{ ['--n' as string]: cols.length || ADVENT_DAYS }}>
                  {cols.map((c) => (
                    <i
                      key={c.n}
                      className={
                        c.freeState === 'claimed'
                          ? 'got'
                          : c.freeState === 'ready'
                            ? 'now'
                            : c.freeState === 'missed'
                              ? 'gone'
                              : c.n === ADVENT_DAYS || adventWeekend(season, c.n)
                                ? 'ms'
                                : ''
                      }
                    />
                  ))}
                </span>
              </div>
            </div>
            <div className="bp-hero-cta">
              {can ? (
                <button className="btn lg primary bp-claim" disabled={busy || !!extra?.busy} data-track="advent_open_today" onClick={openToday}>
                  <PxIcon name="gift" size={24} />
                  {t('Открыть')}
                  {ready.length > 1 ? <b className="bp-count">{ready.length}</b> : null}
                </button>
              ) : (
                <b className="bp-timer">
                  <Icon id="i-clock" />
                  {timerText(left)}
                </b>
              )}
              {!own ? (
                <button className="bp-plus" data-track="plus_subscribe" onClick={onPlus}>
                  <Icon id="i-crown" />
                  <span>{t('Открыть PLUS')}</span>
                  {price && plusPrice('PLUS') ? <small>{t('{price}/мес', { price: plusPrice('PLUS') ?? '' })}</small> : null}
                </button>
              ) : null}
            </div>
            {onClose ? (
              <button className="icon-btn bp-x" aria-label={t('Закрыть')} data-track="close" onClick={onClose}>
                <Icon id="i-x" />
              </button>
            ) : null}
          </div>

          <div className="bp-rail">
            <div className="bp-legend" aria-hidden="true">
              <span className="free">
                <PxIcon name="gift" size={24} />
              </span>
              <span className="plus">
                <PlusMark height={20} />
              </span>
            </div>
            <div className="bp-view">
              <div className="bp-scroll" ref={ref}>
                <div className="bp-track">
                  {cols.map((c) => {
                    const last = c.n === ADVENT_DAYS
                    const date = adventDate(season, c.n)
                    const passed = c.n < today
                    return (
                      <div
                        key={c.n}
                        className={
                          'bp-col av-col' +
                          (c.n === focusN ? ' focus' : '') +
                          (c.n === today ? ' today' : '') +
                          (c.n <= today ? ' done' : '') +
                          (last ? ' last' : '') +
                          (adventWeekend(season, c.n) ? ' ms' : '')
                        }
                      >
                        <Door
                          col={c}
                          row="free"
                          state={c.freeState}
                          last={last}
                          intact={free.intact}
                          soon={c.n === nextN && left > 0 ? timerText(left) : null}
                          opening={opening.includes(cellKey(c.n, 'free'))}
                          onOpen={() => openCell(c.n, 'free')}
                          onLocked={onPlus}
                        />
                        <span className={'bp-node' + (c.n <= today ? ' done' : '') + (passed ? ' past' : '')}>
                          <b className="bp-day" aria-label={date.toLocaleDateString(intlTag(), { day: 'numeric', month: 'long', timeZone: 'UTC' })}>
                            {c.n}
                          </b>
                        </span>
                        <Door
                          col={c}
                          row="plus"
                          state={c.plusState}
                          last={last}
                          intact={plus.intact}
                          soon={null}
                          opening={opening.includes(cellKey(c.n, 'plus'))}
                          onOpen={() => openCell(c.n, 'plus')}
                          onLocked={onPlus}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
              <button type="button" className="bp-arrow l" aria-label={t('Раньше')} disabled={!edge.l} onClick={() => page(-1)}>
                <Icon id="i-chev-l" />
              </button>
              <button type="button" className="bp-arrow r" aria-label={t('Дальше')} disabled={!edge.r} onClick={() => page(1)}>
                <Icon id="i-chev-r" />
              </button>
            </div>
          </div>
        </div>
      </div>
      {below}
      {layer}
    </div>
  )
}
