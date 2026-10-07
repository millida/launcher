import { useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { PlusMark } from '../premium/PlusMark'
import { rubles } from '../../lib/rubies'
import { CYCLE_DAYS, TRACK_DAYS, timerText, type CellState, type PassCol, type Row, type TrackReward } from './track'
import { useRail } from './useRail'
import { rarityTone, rewardLabel, rewardTitle, RewardArt } from './rewards'
import '../../styles/pixel/pass.css'

/**
 * Пропуск сезона v4 (06.10.2026, «как в Brawl Stars и на Majestic»):
 * герой сезона с персонажем и шкалой 28 дней, под ним лента крупных карточек —
 * сверху бесплатная награда, по центру номер дня на линии прогресса, снизу
 * PLUS (золото, у закрытых — корона-замок). Сегодняшний столбец светится,
 * забранное — с галочкой. Забор: награда летит в баланс, дальше общий миг.
 * Данные и запросы — прежние (`useDaily`), компонент только рисует.
 */

/** Вехи сезона — конец каждой недели: карточка крупнее и золотая подложка. */
const milestone = (n: number) => n % CYCLE_DAYS === 0

type Fly = { id: number; reward: TrackReward; x: number; y: number; dx: number; dy: number; delay: number }

/** Куда летит награда: рубины — в баланс, сундуки — в «Мои сундуки». */
function flyTarget(r: TrackReward): DOMRect | null {
  const sel = r.kind === 'CHEST' ? ['.mc-cell', '[data-cur="rubies"]'] : ['[data-cur="rubies"]', '.sh-bal']
  for (const s of sel) {
    const el = document.querySelector<HTMLElement>(s)
    const rect = el?.getBoundingClientRect()
    if (rect && rect.width > 0) return rect
  }
  return null
}

let flyId = 0

/** Полёт наград к балансу: картинка награды по дуге, у цели — вспышка. */
function useFlights() {
  const [flights, setFlights] = useState<Fly[]>([])
  const launch = (items: { el: HTMLElement | null; reward: TrackReward }[]) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const next: Fly[] = []
    items.slice(0, 6).forEach(({ el, reward }, i) => {
      const from = el?.querySelector('.ra')?.getBoundingClientRect()
      if (!from) return
      const to = flyTarget(reward)
      const tx = to ? to.left + to.width / 2 : innerWidth - 120
      const ty = to ? to.top + to.height / 2 : 30
      const x = from.left + from.width / 2
      const y = from.top + from.height / 2
      next.push({ id: ++flyId, reward, x, y, dx: tx - x, dy: ty - y, delay: i * 90 })
    })
    if (!next.length) return
    setFlights((f) => [...f, ...next])
    const ids = new Set(next.map((n) => n.id))
    const last = next[next.length - 1].delay
    window.setTimeout(() => {
      document.querySelector('[data-cur="rubies"]')?.classList.add('bp-hit')
      window.setTimeout(() => document.querySelector('[data-cur="rubies"]')?.classList.remove('bp-hit'), 420)
    }, 640 + last)
    window.setTimeout(() => setFlights((f) => f.filter((x) => !ids.has(x.id))), 900 + last)
  }
  const layer = flights.length
    ? createPortal(
        <div className="bp-flights" aria-hidden="true">
          {flights.map((f) => (
            <span
              key={f.id}
              className="bp-fly"
              style={
                {
                  left: f.x + 'px',
                  top: f.y + 'px',
                  '--dx': f.dx + 'px',
                  '--dy': f.dy + 'px',
                  animationDelay: f.delay + 'ms',
                } as CSSProperties
              }
            >
              {f.reward.kind === 'CHEST' ? <PxIcon name="chest" size={48} /> : <RewardArt reward={f.reward} size={52} />}
            </span>
          ))}
        </div>,
        document.body,
      )
    : null
  return { launch, layer }
}

function Card({
  col,
  row,
  state,
  soon,
  big,
  onClaim,
  onLocked,
}: {
  col: PassCol
  row: Row
  state: CellState
  soon: string | null
  big: boolean
  onClaim: (el: HTMLElement) => void
  onLocked: () => void
}) {
  const list = row === 'free' ? col.free : col.plus
  const first = list[0]
  const style = first ? ({ '--ra-tone': rarityTone(first) } as CSSProperties) : undefined
  const many = list.length > 1
  // PLUS — крупнее и богаче, бесплатная — скромнее (владелец 06.10.2026).
  const size = (row === 'plus' ? (big ? 116 : 104) : big ? 76 : 68) - (many ? (row === 'plus' ? 56 : 24) : 0)
  const title = list.map(rewardTitle).join(', ')
  const label = list.map(rewardLabel).join(' + ')
  const cls = 'bp-card ' + row + ' ' + state + (milestone(col.n) ? ' ms' : '')
  const inner = (
    <>
      {row === 'plus' && state !== 'claimed' ? <i className="bp-shine" aria-hidden="true" /> : null}
      <span className={'bp-art' + (many ? ' many' : '')}>
        {list.map((r, i) => (
          <RewardArt key={i} reward={r} size={size} />
        ))}
      </span>
      {state === 'ready' ? (
        <b className="bp-take">Забрать</b>
      ) : soon ? (
        <b className="bp-tag soon">
          <Icon id="i-clock" />
          {soon}
        </b>
      ) : (
        <b className={'bp-tag' + (many ? ' many' : '')}>{label || '—'}</b>
      )}
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
  const aria = (row === 'plus' ? 'PLUS, ' : '') + 'день ' + col.n + ': ' + title
  const slot = 'bp-slot ' + row + ' ' + state
  if (state === 'ready' || state === 'locked') {
    return (
      <span className={slot}>
        <button
          type="button"
          className={cls}
          style={style}
          aria-label={(state === 'ready' ? 'Забрать — ' : 'Только с PLUS — ') + aria}
          data-track={state === 'ready' ? 'daily_claim_cell' : 'daily_locked_cell'}
          data-kind="pass_cell"
          data-id={row + ':' + col.n}
          onClick={(e) => (state === 'ready' ? onClaim(e.currentTarget) : onLocked())}
        >
          {inner}
        </button>
      </span>
    )
  }
  return (
    <span className={slot}>
      <span className={cls} style={style} aria-label={aria}>
        {inner}
      </span>
    </span>
  )
}

/** Искры над сценой: позиции заданы заранее, чтобы кадр не прыгал между рендерами. */
const EMBERS = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 53 + 7) % 100,
  y: 30 + ((i * 37) % 60),
  d: (i % 6) * 0.7,
  s: 3 + (i % 3),
  t: 5 + (i % 4) * 1.3,
}))

/**
 * Сцена сезона: пиксельный закат слоями (scripts/season-art.py) — небо с
 * солнцем и лучами, горы, холмы с замком, передний край; искры поднимаются,
 * слои чуть смещаются за курсором (параллакс через --mx/--my героя).
 */
function SeasonScene() {
  return (
    <span className="bp-scene" aria-hidden="true">
      <img className="bp-l sky" src="/season/sky.png" alt="" draggable={false} />
      <img className="bp-l far" src="/season/far.png" alt="" draggable={false} />
      <img className="bp-l mid" src="/season/mid.png" alt="" draggable={false} />
      <span className="bp-embers">
        {EMBERS.map((e, i) => (
          <i
            key={i}
            style={
              {
                left: e.x + '%',
                top: e.y + '%',
                width: e.s + 'px',
                height: e.s + 'px',
                animationDelay: -e.d + 's',
                animationDuration: e.t + 's',
              } as CSSProperties
            }
          />
        ))}
      </span>
      <img className="bp-l near" src="/season/near.png" alt="" draggable={false} />
    </span>
  )
}

const parallax = (e: RPointerEvent<HTMLDivElement>) => {
  if (e.pointerType !== 'mouse') return
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3))
  e.currentTarget.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3))
}
const parallaxOff = (e: RPointerEvent<HTMLDivElement>) => {
  e.currentTarget.style.setProperty('--mx', '0')
  e.currentTarget.style.setProperty('--my', '0')
}

export function SeasonPass({
  cols,
  own,
  left,
  busy,
  focus,
  endsAt,
  streak,
  price,
  compact,
  extra,
  onClaim,
  onClaimAll,
  onPlus,
  onClose,
  below,
}: {
  cols: PassCol[]
  own: boolean
  /** Мс до открытия следующей клетки. */
  left: number
  busy: boolean
  focus: unknown
  endsAt: string | null
  streak: number
  /** Цена PLUS в копейках (0 — не показывать). */
  price: number
  /** Магазин: ниже герой и карточки. */
  compact?: boolean
  /** Забрать есть что-то ещё (неделя, задания), когда клетки пусты. */
  extra?: { busy: boolean; onClaim: () => void } | null
  onClaim: (day: number, row: Row) => void
  onClaimAll: () => void
  onPlus: () => void
  onClose?: () => void
  below?: ReactNode
}) {
  const { ref, edge, page } = useRail(focus, 3 * (compact ? 136 : 152), '.bp-col.focus')
  const { launch, layer } = useFlights()
  const ready = cols.flatMap((c) => [
    ...(c.freeState === 'ready' ? [{ day: c.n, row: 'free' as Row }] : []),
    ...(c.plusState === 'ready' ? [{ day: c.n, row: 'plus' as Row }] : []),
  ])
  const open = cols.reduce((m, c) => (c.freeState !== 'future' ? c.n : m), 0)
  const nextN = cols.find((c) => c.freeState === 'future')?.n ?? 0
  const focusN =
    (cols.find((c) => c.freeState === 'ready' || c.plusState === 'ready') ?? cols.find((c) => c.n === nextN) ?? cols[cols.length - 1])?.n
  const total = cols.length || TRACK_DAYS
  const can = ready.length > 0 || !!extra
  const end = endsAt ? new Date(endsAt) : null
  const endText = end && Number.isFinite(end.getTime()) ? end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''

  const claimCell = (day: number, row: Row, el: HTMLElement) => {
    if (busy) return
    const col = cols.find((c) => c.n === day)
    const reward = col ? (row === 'free' ? col.free : col.plus)[0] : undefined
    if (reward) launch([{ el, reward }])
    onClaim(day, row)
  }
  const claimAll = () => {
    if (busy) return
    if (!ready.length) return extra?.onClaim()
    const root = ref.current
    launch(
      ready.flatMap(({ day, row }) => {
        const col = cols.find((c) => c.n === day)
        const reward = col ? (row === 'free' ? col.free : col.plus)[0] : undefined
        const el = root?.querySelector<HTMLElement>('[data-id="' + row + ':' + day + '"]') ?? null
        return reward ? [{ el, reward }] : []
      }),
    )
    onClaimAll()
  }

  return (
    <div className={'bp' + (compact ? ' compact' : '') + (own ? ' own' : '')}>
      <div className="bp-stage" onPointerMove={parallax} onPointerLeave={parallaxOff}>
        <SeasonScene />
        {/* Герой сезона — своя колонна справа, не заходит на карточки и стоит неподвижно. */}
        <span className="bp-side" aria-hidden="true">
          <img className="bp-rig" src="/season/hero.webp" alt="" draggable={false} />
        </span>
        <div className="bp-main">
      <div className="bp-hero">
        <div className="bp-hero-main">
          <span className="bp-kicker">
            Сезон
            {endText ? <i>до {endText}</i> : null}
            {streak > 0 ? (
              <i className="bp-streak">
                <Icon id="i-flame" />
                {streak}
              </i>
            ) : null}
          </span>
          <h2 className="bp-title">Пропуск сезона</h2>
          <div className="bp-progress" aria-label={'Открыто дней: ' + open + ' из ' + total}>
            <b className="bp-progress-n">
              {open}
              <small>/{total}</small>
            </b>
            <span className="bp-bar" style={{ ['--n' as string]: total }}>
              {cols.map((c) => (
                <i
                  key={c.n}
                  className={
                    c.freeState === 'claimed'
                      ? 'got'
                      : c.freeState === 'ready'
                        ? 'now'
                        : milestone(c.n)
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
            <button className="btn lg primary bp-claim" disabled={busy || !!extra?.busy} data-track="daily_claim" onClick={claimAll}>
              <PxIcon name="gift" size={24} />
              Забрать
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
              <span>Открыть PLUS</span>
              {price ? <small>{rubles(price)}/мес</small> : null}
            </button>
          ) : null}
        </div>
        {onClose ? (
          <button className="icon-btn bp-x" aria-label="Закрыть" data-track="close" onClick={onClose}>
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
                const done = c.n <= open
                return (
                  <div
                    key={c.n}
                    className={
                      'bp-col' +
                      (c.n === focusN ? ' focus' : '') +
                      (c.n === open ? ' today' : '') +
                      (done ? ' done' : '') +
                      (c.n === open + 1 || c.n === 1 ? ' edge' : '') +
                      (milestone(c.n) ? ' ms' : '')
                    }
                  >
                    <Card
                      col={c}
                      row="free"
                      state={c.freeState}
                      soon={c.n === nextN && left > 0 ? timerText(left) : null}
                      big={milestone(c.n)}
                      onClaim={(el) => claimCell(c.n, 'free', el)}
                      onLocked={onPlus}
                    />
                    <span className={'bp-node' + (done ? ' done' : '') + (c.n < open ? ' past' : '')}>
                      <b className="bp-day">{c.n}</b>
                    </span>
                    <Card
                      col={c}
                      row="plus"
                      state={c.plusState}
                      soon={null}
                      big={milestone(c.n)}
                      onClaim={(el) => claimCell(c.n, 'plus', el)}
                      onLocked={onPlus}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          <button type="button" className="bp-arrow l" aria-label="Раньше" disabled={!edge.l} onClick={() => page(-1)}>
            <Icon id="i-chev-l" />
          </button>
          <button type="button" className="bp-arrow r" aria-label="Дальше" disabled={!edge.r} onClick={() => page(1)}>
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
