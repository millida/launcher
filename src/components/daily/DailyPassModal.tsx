import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { PlusCelebration } from '../PlusCelebration'
import { backdropClose } from '../../lib/dismiss'
import { openExt, PLUS_MANAGE_URL } from '../../lib/api'
import { rubles } from '../../lib/rubies'
import type { GrantedReward, Reward } from '../../lib/rubies'
import { useDaily } from '../../state/daily'
import { usePlus } from '../../state/plus'
import { showReward, type RewardEntry } from '../reward/RewardReveal'
import { shardWord, word as rubyWord } from '../shop/rarity'
import {
  CYCLE_DAYS,
  nextResetAt,
  passCols,
  readyCells,
  seasonal,
  seasonOf,
  targetRewards,
  timerText,
  type CellState,
  type PassCol,
  type Row,
  type TrackReward,
} from './track'
import { useCountdown } from './useCountdown'
import { useRail } from './useRail'
import { Chest3D } from './Chest3D'
import { grantedOf, Reveal } from './Reveal'
import { WeekItem } from './WeekItem'
import { LegacyTrack } from './LegacyTrack'
import { ChestArt } from './ChestArt'
import { MyChests } from './MyChests'
import { ChestOpenHost } from './ChestOpen'
import { PlusCard } from './PlusCard'
import { CHEST_NAME, dayChestTier, rarityTone, rewardLabel, rewardTitle, RewardArt } from './rewards'
import '../../styles/pixel/daily.css'
import { wearNow } from '../../state/wearIntent'

const real = (list: TrackReward[]) => list.filter((r): r is Reward => r.kind !== 'MYSTERY')

/**
 * Клетка пасса — осколки или сундук (вещей в бонусе нет, решение владельца
 * 24.09.2026) со своим состоянием:
 * claimed — серая с галочкой; ready — яркая, пульсирует, «Забрать»;
 * locked — строка PLUS без подписки: награда во всей красе и замок, клик
 * открывает «Оформить PLUS»; future — ждёт своего дня входа, у ближайшей
 * бесплатной — таймер до открытия.
 */
function Cell({
  col,
  row,
  state,
  soon,
  onClaim,
  onLocked,
}: {
  col: PassCol
  row: Row
  state: CellState
  /** Таймер до открытия (только ближайшая бесплатная клетка). */
  soon: string | null
  onClaim: () => void
  onLocked: () => void
}) {
  const rewards = row === 'free' ? col.free : col.plus
  const first = rewards[0]
  const wk = col.cycleDay === 1 && col.cycle > 0
  const cls = 'dp2-cell ' + row + ' ' + state + (wk ? ' wk' : '')
  const style = first ? ({ '--ra-tone': rarityTone(first) } as CSSProperties) : undefined
  const size = state === 'ready' ? 60 : rewards.length > 1 ? 40 : 52
  const title = rewards.map(rewardTitle).join(', ')
  const inner = (
    <>
      <span className="dp2-arts">
        {rewards.map((r, i) => (
          <RewardArt key={i} reward={r} size={size} />
        ))}
      </span>
      {state === 'ready' ? (
        <b className="dp2-take">Забрать</b>
      ) : soon ? (
        <b className="dp2-soon">
          <Icon id="i-clock" />
          {'через ' + soon}
        </b>
      ) : (
        <b className="dp2-label">{rewards.map(rewardLabel).join(' + ') || '—'}</b>
      )}
      {state === 'locked' ? (
        <span className="dp2-mark lock">
          <Icon id="i-lock" />
        </span>
      ) : state === 'claimed' ? (
        <span className="dp2-mark got">
          <Icon id="i-check" />
        </span>
      ) : null}
    </>
  )
  const label = (row === 'plus' ? 'PLUS, ' : '') + 'день ' + col.n + ': ' + title
  if (state === 'ready' || state === 'locked') {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        title={title}
        aria-label={(state === 'ready' ? 'Забрать — ' : 'Только с PLUS — ') + label}
        data-track={state === 'ready' ? 'daily_claim_cell' : 'daily_locked_cell'}
        data-kind="pass_cell"
        data-id={row + ':' + col.n}
        onClick={state === 'ready' ? onClaim : onLocked}
      >
        {inner}
      </button>
    )
  }
  return (
    <div className={cls} style={style} title={title} aria-label={label}>
      {inner}
    </div>
  )
}

/** Ширина клетки ленты (px). */
const COL = 118

/**
 * Пасс сезона: 28 клеток в две строки — сверху «Без подписки», снизу «С PLUS»
 * (золото). Подписи строк закреплены слева. Лента листается вбок; первая
 * открытая клетка — по центру.
 */
function Track({
  cols,
  left,
  focus,
  busy,
  onClaim,
  onLocked,
}: {
  cols: PassCol[]
  /** Сколько мс до открытия следующей клетки. */
  left: number
  focus: unknown
  /** Идёт забор или оформление — клетки не жмутся повторно. */
  busy: boolean
  onClaim: (day: number, row: Row) => void
  /** Клик по закрытой клетке PLUS — оформление подписки. */
  onLocked: () => void
}) {
  const { ref, edge, page } = useRail(focus, (COL + 6) * CYCLE_DAYS, '.dp2-head.focus')
  const grid = cols.map(() => COL + 'px').join(' ')
  const nextN = cols.find((c) => c.freeState === 'future')?.n ?? 0
  const focusN = (cols.find((c) => c.freeState === 'ready' || c.plusState === 'ready') ?? cols.find((c) => c.n === nextN) ?? cols[cols.length - 1])?.n
  const own = cols.some((c) => c.plusState !== 'locked')
  return (
    <div className="dp2-rail">
      <div className={'dp2-side' + (own ? ' own' : '')}>
        <span className="dp2-side-free">Обычные награды</span>
        <span className="dp2-side-plus">
          <PlusBadge />
          <i>Награды PLUS</i>
        </span>
      </div>
      <div className="dp2-view">
        <div className="dp2-scroll" ref={ref}>
          <div className="dp2-track" style={{ gridTemplateColumns: grid }}>
            {cols.map((c) => {
              const st = c.freeState
              const wk = c.cycleDay === 1 && c.cycle > 0
              return (
                <span
                  key={'h' + c.n}
                  className={'dp2-head ' + st + (c.n === focusN ? ' focus' : '') + (wk ? ' wk' : '')}
                >
                  {st === 'claimed' ? <Icon id="i-check" /> : null}
                  {'День ' + c.n}
                </span>
              )
            })}
            {cols.map((c) => (
              <Cell
                key={'f' + c.n}
                col={c}
                row="free"
                state={c.freeState}
                soon={c.n === nextN && left > 0 ? timerText(left) : null}
                onClaim={() => !busy && onClaim(c.n, 'free')}
                onLocked={onLocked}
              />
            ))}
            {cols.map((c) => (
              <Cell
                key={'p' + c.n}
                col={c}
                row="plus"
                state={c.plusState}
                soon={null}
                onClaim={() => !busy && onClaim(c.n, 'plus')}
                onLocked={onLocked}
              />
            ))}
          </div>
        </div>
        <button type="button" className="dp2-arrow l" aria-label="Раньше" disabled={!edge.l} onClick={() => page(-1)}>
          <Icon id="i-chev-l" />
        </button>
        <button type="button" className="dp2-arrow r" aria-label="Дальше" disabled={!edge.r} onClick={() => page(1)}>
          <Icon id="i-chev-r" />
        </button>
      </div>
    </div>
  )
}

const endDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : ''
}

/** Вещь награды — плашка мига награды. */
const itemEntry = (it: { name: string; preview: string | null; rarity?: string }): RewardEntry => ({
  name: it.name,
  preview: it.preview,
  rarity: it.rarity,
})

/**
 * Забранные клетки — общий миг награды. Сундуки — большой миг: сундуки
 * крупно, цветом уровня; дальше они ждут в «Моих сундуках» под лентой и
 * открываются оттуда, когда захочется (решение владельца 24.09.2026: копить
 * можно). Осколки — средний сверху. Вещь приходит только от старой службы.
 */
function announce(granted: GrantedReward[]) {
  const sum = (k: 'RUBIES' | 'SHARDS' | 'FRAGMENTS') => granted.reduce((n, g) => n + (g.kind === k ? g.amount : 0), 0)
  const rub = sum('RUBIES')
  const sh = sum('SHARDS')
  const chests = granted.filter((g): g is GrantedReward & { kind: 'CHEST' } => g.kind === 'CHEST')
  const items = granted.flatMap((g) => (g.kind === 'ITEM' && g.item ? [itemEntry(g.item)] : []))
  const cur: RewardEntry[] = []
  if (rub) cur.push({ name: '+' + rub.toLocaleString('ru-RU') + ' ' + rubyWord(rub), rubies: rub })
  if (sh) cur.push({ name: '+' + sh + ' ' + shardWord(sh), icon: 'shard' })
  const kicker = granted.every((g) => g.source === 'plus') ? 'PLUS' : 'Бонус за вход'
  if (chests.length) {
    const size = chests.length > 1 ? 88 : 150
    showReward({
      items: chests.map((c) => ({
        name: CHEST_NAME[c.tier] + ' сундук',
        rarity: c.tier,
        art: <ChestArt ready tier={c.tier} size={size} />,
      })),
      kicker,
      title: chests.length > 1 ? 'Сундуки: ' + chests.length : undefined,
      sub: cur.length ? cur.map((c) => c.name).join(', ') : undefined,
      doneLabel: 'В сундуки',
    })
    return
  }
  if (items.length) {
    showReward({
      items,
      kicker,
      sub: cur.length ? cur.map((c) => c.name).join(', ') : undefined,
      onWear: () => {
        useDaily.getState().setModal(false)
        wearNow(granted.flatMap((g) => (g.kind === 'ITEM' && g.item ? [{ code: g.item.code, variant: g.item.variant }] : [])))
      },
    })
    return
  }
  if (!cur.length) return
  showReward({ level: 'mid', items: cur, kicker, title: cur.map((c) => c.name).join(' и ') })
}

/**
 * Battle Pass: сезон на 28 клеток. Каждый день входа открывает следующую
 * клетку; открытое можно забрать когда угодно до конца сезона — каждую
 * отдельно, кликом по клетке. В клетке сама награда: осколки, рубины или
 * вещь (сундуков нет — правка владельца 23.09.2026, 22:22). Строка PLUS без
 * подписки видна целиком, но под замками; клик по ней — оформление PLUS.
 * Все числа и вещи — из ответа службы (`GET /v2/rubies/daily`); пока служба
 * не шлёт сезон, клиент считает его сам (track.ts, «прогноз клиента»).
 * Старый ответ без `track` — прежний трек с сундуком и 3D-раскрытием.
 *
 * Тело пасса одно на два места (правка владельца 23.09.2026, 21:58: «пасс
 * исчез — человек должен заходить ради battle pass»): окно `DailyPassModal`
 * и первый блок магазина (`inline`) — крупно, во всю ширину.
 */
export function PassBody({ active, inline, onClose }: { active: boolean; inline?: boolean; onClose?: () => void }) {
  const status = useDaily((s) => s.status)
  const busy = useDaily((s) => s.busy)
  const reveal = useDaily((s) => s.reveal)
  const target = useDaily((s) => s.target)
  const plusJoy = useDaily((s) => s.plusJoy)
  const plusActive = usePlus((s) => s.active)
  const plusInfo = useDaily((s) => s.plus)
  /** Сундуки службы (часы игры, промокод): их показывают «Мои сундуки» и у старой службы. */
  const pending = useDaily((s) => s.pending.length > 0)
  /** Старый трек: идёт 3D-раскрытие сундука. */
  const [revealing, setRevealing] = useState(false)
  /** Сезон: клетка забирается, ждём ответ службы. */
  const [claiming, setClaiming] = useState(false)
  // Награды забора — снимок до ответа службы: после него клетки уже «забраны».
  const [shot, setShot] = useState<{ got: TrackReward[]; missed: TrackReward[] }>({ got: [], missed: [] })

  const own = !!status?.plus || plusActive
  const cols = useMemo(() => passCols(status, own), [status, own])
  const legacy = !seasonal(status)
  const ready = readyCells(cols)
  const hasFuture = cols.some((c) => c.freeState === 'future')
  const left = useCountdown(nextResetAt(status), active && !!status && hasFuture, () => void useDaily.getState().load())
  const track = status?.track?.length ? status.track : null

  useEffect(() => {
    if (!active) {
      setRevealing(false)
      setClaiming(false)
      return
    }
    void useDaily.getState().load()
  }, [active])

  // Забор начат. Забирает только видимое место: окно, когда открыто, иначе
  // блок магазина.
  const mine = inline ? active && !useDaily.getState().modal : active
  useEffect(() => {
    if (busy !== 'claim' || !mine) return
    if (track) {
      setClaiming(true)
      return
    }
    setShot(targetRewards(cols, target, legacy))
    setRevealing(true)
  }, [busy])

  // Ответ пришёл — миг награды; отказ службы уже показан тостом.
  useEffect(() => {
    if (!claiming || busy === 'claim') return
    setClaiming(false)
    const granted = reveal ? grantedOf(reveal) : []
    useDaily.getState().clearReveal()
    announce(granted)
  }, [claiming, busy, reveal])

  const season = status ? seasonOf(status) : null
  const tier = dayChestTier(real(targetRewards(cols, ready[0] ?? null, legacy).got))
  const got = real(shot.got)
  const price = !own && plusInfo && plusInfo.priceKopecks > 0 ? plusInfo.priceKopecks : 0
  // Закрытая клетка PLUS и «Оформить PLUS» — карточка с ценой, не сразу оплата.
  const plus = () => useDaily.getState().setPlusCard(true)
  const claim = (day: number, row: Row) => void useDaily.getState().claim({ day, row })
  const endReveal = () => {
    setRevealing(false)
    useDaily.getState().clearReveal()
  }

  return (
    <>
      <div className="dp-head">
        {inline ? <h2>Бонус за вход</h2> : <h3>Бонус за вход</h3>}
        {status && status.streak > 0 ? (
          <span className="dp-streak">
            <Icon id="i-flame" />
            <b>{status.streak}</b>
            подряд
          </span>
        ) : null}
        {track && season && !legacy ? <span className="dp-season">до {endDate(season.endsAt)}</span> : null}
        {track && ready.length ? (
          <button
            className={'btn md primary dp-all' + (onClose ? '' : ' end')}
            disabled={!!busy}
            data-track="daily_claim"
            onClick={() => void useDaily.getState().claim(legacy ? undefined : 'all')}
          >
            {ready.length > 1 ? 'Забрать всё (' + ready.length + ')' : 'Забрать'}
          </button>
        ) : null}
        {onClose ? (
          <button className="icon-btn dp-x" aria-label="Закрыть" data-track="close" onClick={onClose}>
            <Icon id="i-x" />
          </button>
        ) : null}
      </div>

      {!status ? (
        <span className="skel dp-skel" aria-hidden="true" />
      ) : (
        <div className={inline ? 'dp2-body inline' : 'dp2-body'}>
          {!track || status.weekItem ? (
            <div className="dp2-top">
              {!track ? (
                <div className={'dp2-hero' + (ready.length ? ' ready' : '')}>
                  {revealing || !active ? (
                    <span className="dp2-hero-stage" />
                  ) : (
                    <Chest3D className="dp2-hero-stage" tier={tier} mode={ready.length ? 'ready' : 'closed'} />
                  )}
                  {ready.length ? (
                    <button
                      className="btn lg primary dp2-claim"
                      disabled={!!busy}
                      data-track="daily_claim"
                      onClick={() => void useDaily.getState().claim(ready[0])}
                    >
                      Забрать
                    </button>
                  ) : (
                    <b className="dp-timer dp2-timer">
                      <Icon id="i-clock" />
                      {timerText(left)}
                    </b>
                  )}
                </div>
              ) : null}
              {status.weekItem ? <WeekItem item={status.weekItem} /> : null}
            </div>
          ) : null}

          {track ? (
            <div className={'dp2-pass' + (own ? ' own' : '')}>
              {!own ? (
                <div className="dp2-plusbar">
                  <span className="dp2-plusbar-tag">
                    <PlusBadge />
                  </span>
                  {price ? (
                    <span className="dp-price">
                      <b>{rubles(price)}</b>
                      <small>в месяц</small>
                    </span>
                  ) : null}
                  <button className="btn md secondary dp-plus" disabled={busy === 'plus'} data-track="plus_subscribe" onClick={plus}>
                    <Icon id="i-crown" />
                    Оформить PLUS
                  </button>
                </div>
              ) : null}
              <Track cols={cols} left={left} focus={claiming} busy={!!busy} onClaim={claim} onLocked={plus} />
              {status.chests || pending ? <MyChests /> : null}
            </div>
          ) : null}
          {!track ? <LegacyTrack status={status} own={own} onPlus={plus} /> : null}
          {/* Старая служба: трека нет, но сундуки за часы игры ждут открытия. */}
          {!track && pending ? <MyChests /> : null}

          {!inline && (own || !track) ? (
            <div className="dp-foot">
              <span className="dp-foot-body" />
              {!own && price ? (
                <span className="dp-price">
                  <b>{rubles(price)}</b>
                  <small>в месяц</small>
                </span>
              ) : null}
              {!own ? (
                <button className="btn md secondary dp-plus" disabled={busy === 'plus'} data-track="plus_subscribe" onClick={plus}>
                  <Icon id="i-crown" />
                  Оформить PLUS
                </button>
              ) : (
                <button className="btn sm ghost" data-track="plus_manage" onClick={() => openExt(PLUS_MANAGE_URL)}>
                  Отменить PLUS
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
      {revealing && !track ? (
        <Reveal
          res={reveal}
          busy={busy === 'claim'}
          own={own}
          missed={own ? [] : real(shot.missed)}
          priceKopecks={price}
          onPlus={plus}
          onDone={endReveal}
          tier={got.length ? dayChestTier(got) : undefined}
        />
      ) : null}
      {plusJoy != null && mine ? <PlusCelebration items={plusJoy} onDone={() => useDaily.getState().endPlusJoy()} /> : null}
      {mine ? <PlusCard cols={cols} /> : null}
      {/* Окно открытия живёт здесь, а не в плитке: последний открытый сундук
          убирает «Мои сундуки», а удары и карточки должны доиграть. */}
      <ChestOpenHost />
    </>
  )
}

/** Окно пасса (открывается из других мест, например «Весь трек»). */
export function DailyPassModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [vis, setVis] = useState(false)
  const track = useDaily((s) => !!s.status?.track?.length)

  useEffect(() => {
    if (!open) {
      setVis(false)
      return
    }
    const raf = requestAnimationFrame(() => setVis(true))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className={'modal-bg open dp-bg' + (vis ? ' vis' : '')} {...backdropClose(onClose)}>
      <div className={'modal dp' + (track ? ' dp2' : ' mw-lg')} role="dialog" aria-modal="true" aria-label="Бонус за вход">
        <PassBody active={open} onClose={onClose} />
      </div>
    </div>,
    document.body,
  )
}

/** Золотой бейдж PLUS с короной (владелец 24.09.2026, 19:35). */
export function PlusBadge() {
  return (
    <span className="plus-badge">
      <Icon id="i-crown" />
      PLUS
    </span>
  )
}
