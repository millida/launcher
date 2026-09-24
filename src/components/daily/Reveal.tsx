import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { playSound } from '../../lib/sound'
import { rubles } from '../../lib/rubies'
import type { ChestTier, DailyClaim, GrantedReward, Reward, WeekItem as WeekItemData } from '../../lib/rubies'
import { useDaily } from '../../state/daily'
import { useUi } from '../../state/ui'
import { Chest3D } from './Chest3D'
import type { ChestMode } from './chestScene'
import { FragmentCells } from './WeekItem'
import { dayChestTier, rarityTone, rewardLabel, rewardTitle, RewardArt } from './rewards'

/** Минимум тряски, даже если служба ответила мгновенно: иначе нет «момента». */
const SHAKE_MS = 1500
/** Шаг между карточками: каждая успевает «плюхнуться» до следующей. */
const BEAT_MS = 460
const COUNT_MS = 700

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!run) return
    if (reducedMotion()) {
      setShown(to)
      return
    }
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / COUNT_MS)
      setShown(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, run])
  return <>{shown}</>
}

/**
 * Награды из ответа. Старая служба не шлёт `granted` — собираем из прежних
 * полей. Фрагменты, ушедшие в рубины (вещь уже есть), показываем рубинами:
 * пришли именно они.
 */
export function grantedOf(res: DailyClaim): GrantedReward[] {
  if (res.granted?.length)
    return res.granted.map((g) =>
      g.kind === 'FRAGMENTS' && g.convertedRubies ? { kind: 'RUBIES', amount: g.convertedRubies, source: g.source } : g,
    )
  const list: GrantedReward[] = []
  if (res.gained > 0) list.push({ kind: 'RUBIES', amount: res.gained, source: 'free' })
  if (res.chestId) list.push({ kind: 'CHEST', tier: res.todayChest || 'COMMON', source: 'free' })
  return list
}

function Card({ reward, plus, index }: { reward: Reward; plus?: boolean; index: number }) {
  const style = { '--rv-tone': rarityTone(reward), '--rv-i': index } as CSSProperties
  return (
    <span className={'rv-card' + (plus ? ' plus' : '') + ' k-' + reward.kind.toLowerCase()} style={style} title={rewardTitle(reward)}>
      <span className="rv-card-in">
        <span className="rv-flash" />
        {plus ? (
          <span className="rv-card-crown">
            <Icon id="i-crown" />
          </span>
        ) : null}
        <span className="rv-card-art">
          <RewardArt reward={reward} size={84} />
        </span>
        <b className="rv-card-label">
          {reward.kind === 'RUBIES' ? (
            <>
              +<CountUp to={reward.amount} run />
            </>
          ) : (
            rewardLabel(reward)
          )}
        </b>
      </span>
    </span>
  )
}

type Beat =
  | { kind: 'card'; reward: Reward; plus: boolean }
  | { kind: 'plus-head' }
  | { kind: 'missed' }
  | { kind: 'week' }
  | { kind: 'unlocked' }
  | { kind: 'acts' }

/**
 * Миг награды на весь экран, как открытие сундука в Brawl Stars:
 * 3D-сундук трясётся всё сильнее, крышка откидывается, бьёт столб света цвета
 * редкости, награды вылетают карточками по одной. Сначала бесплатное, потом
 * PLUS отдельной волной с короной. Без подписки после бесплатного — «С PLUS
 * было бы ещё» с тем, что PLUS дал бы сегодня, ценой и кнопкой; без таймеров.
 *
 * Клик по пустому месту проматывает анимацию до конца.
 */
export function Reveal({
  res,
  busy,
  own,
  missed,
  priceKopecks,
  onPlus,
  onDone,
  tier: dayTier,
  chest = true,
}: {
  /**
   * В клетке сундук — 3D-сундук трясётся и открывается. Нет — сундука нет:
   * карточка награды сразу вылетает на тёмный фон.
   */
  chest?: boolean
  /** Каким выглядит сундук, пока ответа ещё нет (награды дня известны заранее). */
  tier?: ChestTier
  res: DailyClaim | null
  busy: boolean
  own: boolean
  /** Что строка PLUS дала бы сегодня (только тем, у кого подписки нет). */
  missed: Reward[]
  priceKopecks: number
  onPlus: () => void
  onDone: () => void
}) {
  const reduced = useMemo(reducedMotion, [])
  // Вещь недели до «Забрать»: служба пришлёт новое значение, а загореться
  // должны только пришедшие клетки.
  const weekBefore = useRef<WeekItemData | null | undefined>(useDaily.getState().status?.weekItem)
  const [minDone, setMinDone] = useState(reduced || !chest)
  const [opened, setOpened] = useState(false)
  const [shown, setShown] = useState(0)

  useEffect(() => {
    playSound('open')
    if (reduced) return
    const id = window.setTimeout(() => setMinDone(true), SHAKE_MS)
    return () => window.clearTimeout(id)
  }, [])

  // Служба отказала: тост уже показан, открывать нечего.
  useEffect(() => {
    if (minDone && !busy && !res) onDone()
  }, [minDone, busy, res])

  const granted = res ? grantedOf(res) : []
  const free = granted.filter((g) => g.source !== 'plus')
  const plusGot = granted.filter((g) => g.source === 'plus')
  const week = res?.weekItem ?? weekBefore.current ?? null
  const fragGain = granted.reduce((n, g) => n + (g.kind === 'FRAGMENTS' ? g.amount : 0), 0)
  const showMissed = !!res && !own && !res.plus && missed.length > 0
  // Старый ответ слал true, новый — саму вещь.
  const unlockedItem =
    res?.weekItemUnlocked && typeof res.weekItemUnlocked === 'object'
      ? res.weekItemUnlocked
      : res?.weekItemUnlocked && week
        ? week
        : null

  const beats: Beat[] = useMemo(() => {
    const out: Beat[] = free.map((r) => ({ kind: 'card' as const, reward: r, plus: false }))
    if (plusGot.length) {
      out.push({ kind: 'plus-head' })
      plusGot.forEach((r) => out.push({ kind: 'card', reward: r, plus: true }))
    } else if (showMissed) out.push({ kind: 'missed' })
    if (week && fragGain > 0) out.push({ kind: 'week' })
    if (unlockedItem) out.push({ kind: 'unlocked' })
    out.push({ kind: 'acts' })
    return out
  }, [res])

  const mode: ChestMode = !minDone || busy || !res ? 'shake' : 'open'

  // Без сундука: как только пришёл ответ — сразу карточки.
  useEffect(() => {
    if (!chest && res && !busy && !opened) {
      playSound('achievement')
      setOpened(true)
    }
  }, [chest, res, busy])
  const tier = dayTier ?? dayChestTier(granted)

  // Карточки идут по одной после того, как крышка распахнулась.
  useEffect(() => {
    if (!opened || !res) return
    if (reduced) {
      setShown(beats.length)
      return
    }
    if (shown >= beats.length) return
    const id = window.setTimeout(
      () => {
        const b = beats[shown]
        if (b?.kind === 'card') playSound(b.plus ? 'achievement' : 'success')
        if (b?.kind === 'plus-head' || b?.kind === 'unlocked') playSound('notify')
        setShown((n) => n + 1)
      },
      // Перед праздником вещи — пауза: шкала фрагментов должна успеть заполниться.
      shown === 0 ? 260 : beats[shown]?.kind === 'unlocked' ? 1500 : BEAT_MS,
    )
    return () => window.clearTimeout(id)
  }, [opened, shown, res])

  const onOpened = () => {
    playSound('achievement')
    setOpened(true)
  }

  const visible = beats.slice(0, shown)
  const has = (k: Beat['kind']) => visible.some((b) => b.kind === k)
  const freeCards = visible.filter((b): b is Extract<Beat, { kind: 'card' }> => b.kind === 'card' && !b.plus)
  const plusCards = visible.filter((b): b is Extract<Beat, { kind: 'card' }> => b.kind === 'card' && b.plus)
  const finished = shown >= beats.length && opened

  const toChests = !!res?.chestId
  let acts: ReactNode = null
  if (has('acts')) {
    acts = (
      <span className="rv-acts">
        {/* Сундук из клетки открывается сразу (правка 21:58: «инвентаря
            сундуков быть не должно»): магазин раскрывает его сам. */}
        <button
          className="btn md primary"
          autoFocus
          onClick={() => {
            onDone()
            if (toChests) {
              useDaily.getState().setModal(false)
              useUi.getState().setScreen('rubies')
            }
          }}
        >
          {toChests ? 'Открыть сундук' : 'К наградам'}
        </button>
      </span>
    )
  }

  return createPortal(
    <div
      className={'rv' + (opened ? ' opened' : '') + (chest ? '' : ' nochest') + ' tier-' + tier.toLowerCase()}
      role="status"
      aria-label="Награда дня"
      onClick={() => {
        if (opened && !finished) setShown(beats.length)
      }}
    >
      {chest ? (
        <div className="rv-stage">
          <Chest3D tier={tier} mode={mode} framing="reveal" onOpened={onOpened} />
        </div>
      ) : null}

      <div className="rv-flow">
        {/* Бесплатное и PLUS — рядом, двумя волнами: у подписчика обе. */}
        <div className="rv-groups">
          {freeCards.length ? (
            <div className="rv-row">
              {freeCards.map((b, i) => (
                <Card key={'f' + i} reward={b.reward} index={i} />
              ))}
            </div>
          ) : null}
          {has('plus-head') ? (
            <div className="rv-wave">
              <span className="rv-wave-tag">
                <Icon id="i-crown" />
                PLUS
              </span>
              <div className="rv-row">
                {plusCards.map((b, i) => (
                  <Card key={'p' + i} reward={b.reward} plus index={i} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {has('missed') ? (
          <div className="rv-missed">
            <span className="rv-missed-head">
              <Icon id="i-crown" />С PLUS было бы ещё:
            </span>
            <span className="rv-missed-row">
              {missed.map((r, i) => (
                <span key={i} className="rv-missed-item" style={{ '--rv-tone': rarityTone(r) } as CSSProperties} title={rewardTitle(r)}>
                  <RewardArt reward={r} size={56} />
                  <b>{rewardLabel(r)}</b>
                </span>
              ))}
            </span>
            <span className="rv-missed-act">
              {priceKopecks > 0 ? <b className="rv-price">{rubles(priceKopecks)} в месяц</b> : null}
              <button
                className="btn md secondary dp-plus"
                onClick={(e) => {
                  e.stopPropagation()
                  onPlus()
                }}
              >
                <Icon id="i-crown" />
                Оформить PLUS
              </button>
            </span>
          </div>
        ) : null}

        {has('week') && week ? (
          <div className="rv-week" style={{ '--wi-tone': rarityTone({ kind: 'ITEM', item: week }) } as CSSProperties}>
            {week.preview ? <img src={week.preview} alt="" draggable={false} /> : null}
            <span className="rv-week-body">
              <b>{week.name}</b>
              <FragmentCells have={Math.min(week.have, week.need)} need={week.need} gain={Math.min(fragGain, week.have)} />
            </span>
            <b className="rv-week-n">
              {Math.min(week.have, week.need)}/{week.need}
            </b>
          </div>
        ) : null}

        {acts}
      </div>

      {has('unlocked') && unlockedItem ? (
        <div
          className="rv-unlock"
          style={{ '--rv-tone': rarityTone({ kind: 'ITEM', item: unlockedItem }) } as CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="rv-unlock-rays" aria-hidden="true" />
          <span className="rv-unlock-art">
            {unlockedItem.preview ? <img src={unlockedItem.preview} alt="" draggable={false} /> : null}
          </span>
          <span className="rv-unlock-kicker">Вещь собрана</span>
          <b className="rv-unlock-name">{unlockedItem.name}</b>
          <button className="btn md primary" autoFocus onClick={onDone}>
            К наградам
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
