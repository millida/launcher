import { Icon } from '../Icon'
import { Chest } from '../Chest'
import { Ruby } from '../Ruby'
import { dayState, rubiesText, trackDays, type DailyView, type TrackDay } from './track'

/*
 * Трек старой схемы (до 23.09.2026): служба шлёт только `cycle` с рубинами
 * и сундуком по дням. Остаётся, пока бэкенд не начал слать `track`, чтобы
 * лаунчер не ломался на старом ответе.
 */

function Cell({
  kind,
  day,
  state,
  locked,
  label,
  onLocked,
}: {
  kind: 'free' | 'plus'
  day: TrackDay
  state: string
  locked: boolean
  label: string
  onLocked?: () => void
}) {
  const part = kind === 'plus' ? day.bonus : day.base
  const chest = kind === 'free' && !!part.chest
  const text = rubiesText(part)
  const cls = 'dp-cell ' + kind + (state ? ' ' + state : '') + (locked ? ' locked' : '')
  const inner = (
    <>
      {kind === 'free' ? (
        <span className="dp-day">{state === 'got' ? <Icon id="i-check" /> : label}</span>
      ) : null}
      {chest ? <Chest size={34} /> : <Ruby size={kind === 'plus' ? 26 : 24} />}
      <b>{chest ? 'Сундук' : text || '—'}</b>
      {locked ? (
        <span className="dp-mark lock">
          <Icon id="i-lock" />
        </span>
      ) : state === 'got' && kind === 'plus' ? (
        <span className="dp-mark">
          <Icon id="i-check" />
        </span>
      ) : null}
    </>
  )
  return locked && onLocked ? (
    <button type="button" className={cls} onClick={onLocked} aria-label={'PLUS, день ' + day.day}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  )
}


export function LegacyTrack({ status, own, onPlus }: { status: DailyView; own: boolean; onPlus: () => void }) {
  const days = trackDays(status)
  const label = (day: number) => {
    if (status.cycleDay === day) return status.claimedToday ? 'Взято' : 'Сегодня'
    if (status.cycleDay + 1 === day) return 'Завтра'
    return 'День ' + day
  }
  return (
    <div className="dp-track" style={{ gridTemplateColumns: '64px repeat(' + days.length + ', minmax(0, 1fr))' }}>
      <span className={'dp-cap plus' + (own ? ' own' : '')}>
        <Icon id="i-crown" />
        PLUS
      </span>
      {days.map((d) => (
        <Cell
          key={'p' + d.day}
          kind="plus"
          day={d}
          state={own ? dayState(status, d.day) : ''}
          locked={!own}
          label=""
          onLocked={onPlus}
        />
      ))}
      <span className="dp-cap">Обычная</span>
      {days.map((d) => (
        <Cell key={'f' + d.day} kind="free" day={d} state={dayState(status, d.day)} locked={false} label={label(d.day)} />
      ))}
    </div>
  )
}
