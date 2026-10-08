import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
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
  nextResetAt,
  passCols,
  readyCells,
  seasonal,
  seasonOf,
  targetRewards,
  timerText,
  type Row,
  type TrackReward,
} from './track'
import { useCountdown } from './useCountdown'
import { Chest3D } from './Chest3D'
import { grantedOf, Reveal } from './Reveal'
import { WeekItem } from './WeekItem'
import { LegacyTrack } from './LegacyTrack'
import { ChestLive } from './ChestLive'
import { MyChests } from './MyChests'
import { ChestOpenHost } from './ChestOpen'
import { PlusCard } from './PlusCard'
import { SeasonPass } from './SeasonPass'
import { CHEST_NAME, dayChestTier } from './rewards'
import '../../styles/pixel/daily.css'
import { wearNow } from '../../state/wearIntent'

const real = (list: TrackReward[]) => list.filter((r): r is Reward => r.kind !== 'MYSTERY')

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
        art: <ChestLive ready tier={c.tier} size={size} />,
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
export function PassBody({
  active,
  inline,
  compact,
  onClose,
  mini,
  onPlus,
  extra,
}: {
  active: boolean
  inline?: boolean
  /** Магазин v2: короткий заголовок и «Открыть PLUS» на закрытой строке. */
  compact?: boolean
  onClose?: () => void
  /** Магазин v3: одна кнопка-подарок «Забрать» и ряд клеток значками. */
  mini?: boolean
  /** Своё окно PLUS вместо карточки пропуска. */
  onPlus?: () => void
  /** Забрать есть что-то ещё (неделя, задания), когда клетки пропуска пусты. */
  extra?: { busy: boolean; onClaim: () => void } | null
}) {
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
  const plus = () => (onPlus ? onPlus() : useDaily.getState().setPlusCard(true))
  const claim = (day: number, row: Row) => void useDaily.getState().claim({ day, row })
  const endReveal = () => {
    setRevealing(false)
    useDaily.getState().clearReveal()
  }

  if (mini) {
    const can = ready.length > 0 || !!extra
    return (
      <>
        {!status ? (
          <span className="skel dp-skel bp-skel" aria-hidden="true" />
        ) : track ? (
          <SeasonPass
            compact
            cols={cols}
            own={own}
            left={left}
            busy={!!busy}
            focus={claiming}
            endsAt={season && !legacy ? season.endsAt : null}
            streak={status.streak}
            price={price}
            extra={extra}
            onClaim={claim}
            onClaimAll={() => void useDaily.getState().claim(legacy ? ready[0] : 'all')}
            onPlus={plus}
          />
        ) : (
          <div className="tk3">
            <button
              className={'tk3-gift' + (can ? ' is-ready' : '')}
              disabled={!can || !!busy || !!extra?.busy}
              data-track="daily_claim"
              onClick={() => (ready.length ? void useDaily.getState().claim(legacy ? ready[0] : 'all') : extra?.onClaim())}
            >
              <PxIcon name="gift" size={84} />
              {can ? (
                <b className="tk3-take">Забрать</b>
              ) : (
                <b className="tk3-timer">
                  <Icon id="i-clock" />
                  {timerText(left)}
                </b>
              )}
            </button>
          </div>
        )}
        {status && (status.chests || pending) ? <MyChests /> : null}
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
        <ChestOpenHost />
      </>
    )
  }

  if (track && status) {
    return (
      <>
        <SeasonPass
          compact={inline}
          cols={cols}
          own={own}
          left={left}
          busy={!!busy}
          focus={claiming}
          endsAt={season && !legacy ? season.endsAt : null}
          streak={status.streak}
          price={price}
          onClaim={claim}
          onClaimAll={() => void useDaily.getState().claim(legacy ? undefined : 'all')}
          onPlus={plus}
          onClose={onClose}
          below={status.weekItem || status.chests || pending ? (
            <div className="bp-below">
              {status.weekItem ? <WeekItem item={status.weekItem} /> : null}
              {status.chests || pending ? <MyChests /> : null}
            </div>
          ) : null}
        />
        {plusJoy != null && mine ? <PlusCelebration items={plusJoy} onDone={() => useDaily.getState().endPlusJoy()} /> : null}
        {mine ? <PlusCard cols={cols} /> : null}
        <ChestOpenHost />
      </>
    )
  }

  return (
    <>
      <div className="dp-head">
        {inline ? <h2>{compact ? 'Пропуск' : 'Бонус за вход'}</h2> : <h3>Бонус за вход</h3>}
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
    // Пока окно открыто, экран под ним не прокручивается.
    const content = document.querySelector<HTMLElement>('.content')
    const prev = content?.style.overflow ?? ''
    if (content) content.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      if (content) content.style.overflow = prev
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
