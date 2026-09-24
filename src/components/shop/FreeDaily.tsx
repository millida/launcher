import { useMemo } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { Rays } from '../reward/RewardReveal'
import { useDaily } from '../../state/daily'
import { usePlus } from '../../state/plus'
import { nextResetAt, passCols, readyCells, type Row, type TrackReward } from '../daily/track'
import { shardWord, word } from './rarity'
import { Countdown, Shard } from './parts'
import './gift.css'

/** Что показать крупно: осколки важнее рубинов, вещь — картинкой. */
const RANK: Record<string, number> = { SHARDS: 0, FRAGMENTS: 1, RUBIES: 2, ITEM: 3, CHEST: 4, MYSTERY: 5 }
const pick = (list: TrackReward[]): TrackReward | null => [...list].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))[0] ?? null

/**
 * «Бесплатно» — первая карточка витрины дня (правка владельца 24.09.2026:
 * «как в Brawl Stars — одно предложение бесплатное, что-то маленькое, не
 * предмет, чтобы заходил каждый день и забирал»).
 *
 * Своей награды у карточки нет: она забирает сегодняшнюю клетку бонуса за
 * вход тем же запросом, что и пасс (`useDaily.claim`). Миг награды
 * (`showReward`) показывает пасс в ленте — тот же, что при клике по клетке,
 * поэтому награда не приходит дважды. Забрано — «Завтра» с таймером.
 */
export function FreeDaily() {
  const status = useDaily((s) => s.status)
  const busy = useDaily((s) => s.busy)
  const plusActive = usePlus((s) => s.active)
  const own = !!status?.plus || plusActive

  const view = useMemo(() => {
    if (!status) return null
    const cols = passCols(status, own)
    // Старая служба без трека: одно «забрать сегодня», в нём рубины дня.
    if (!cols.length)
      return {
        cell: null as { day: number; row: Row } | null,
        ready: !status.claimedToday,
        reward: { kind: 'RUBIES', amount: status.todayRubies } as TrackReward,
      }
    const ready = readyCells(cols)
    const cell = ready.find((c) => c.row === 'free') ?? ready[0] ?? null
    if (cell) {
      const col = cols[cell.day - 1]
      return { cell, ready: true, reward: pick(cell.row === 'free' ? col.free : col.plus) }
    }
    const next = cols.find((c) => c.freeState === 'future')
    return { cell: null, ready: false, reward: next ? pick(next.free) : null }
  }, [status, own])

  if (!view) return <span className="skel sh-skel gf-skel" aria-hidden="true" />

  const r = view.reward
  const amount = r && 'amount' in r && typeof r.amount === 'number' ? r.amount : 0
  const art =
    !r || r.kind === 'SHARDS' || r.kind === 'FRAGMENTS' || r.kind === 'MYSTERY' ? (
      <Shard size={84} />
    ) : r.kind === 'RUBIES' ? (
      <Ruby size={78} />
    ) : r.kind === 'ITEM' && r.item?.preview ? (
      <img src={r.item.preview} alt="" draggable={false} />
    ) : (
      <Icon id={r.kind === 'CHEST' ? 'i-chest' : 'i-gift'} />
    )
  const label =
    !r ? 'Подарок' : r.kind === 'SHARDS' ? shardWord(amount) : r.kind === 'RUBIES' ? word(amount) : r.kind === 'ITEM' ? r.item?.name || 'Вещь' : r.kind === 'CHEST' ? 'Сундук' : 'Подарок'
  const claim = () => {
    if (view.cell) void useDaily.getState().claim(view.cell)
    else void useDaily.getState().claim()
  }

  return (
    <div className={'gf sh-free' + (view.ready ? ' is-ready' : ' is-claimed')} style={{ ['--rw-tone' as string]: 'var(--m-accent)' }}>
      <span className="gf-kicker">Бесплатно</span>
      <span className="gf-stage">
        {view.ready ? <Rays className="sh-free-rays" /> : null}
        <span className="gf-prize sh-free-prize">{art}</span>
        {amount ? <b className="gf-amount">+{amount.toLocaleString('ru-RU')}</b> : null}
      </span>
      <span className="gf-line">
        <b>{label}</b>
      </span>
      {view.ready ? (
        <button className="btn md primary gf-btn" disabled={busy === 'claim'} data-track="daily_claim" onClick={claim}>
          Забрать
        </button>
      ) : (
        <span className="sh-tag sh-timer gf-next">
          <Icon id="i-clock" />
          <span>Завтра</span>
          <b>
            <Countdown to={new Date(nextResetAt(status)).toISOString()} onEnd={() => void useDaily.getState().load()} />
          </b>
        </span>
      )}
    </div>
  )
}
