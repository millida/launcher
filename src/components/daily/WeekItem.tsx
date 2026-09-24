import type { CSSProperties } from 'react'
import type { WeekItem as WeekItemData } from '../../lib/rubies'
import { RARITY_TONE } from '../shop/rarity'
import { Icon } from '../Icon'
import { daysWord } from './track'

/** Сколько целых дней до конца периода вещи (минимум 1, пока он идёт). */
export function weekDaysLeft(endsAt: string, now = Date.now()): number {
  const end = Date.parse(endsAt)
  if (!Number.isFinite(end)) return 0
  return Math.max(end > now ? 1 : 0, Math.ceil((end - now) / 86_400_000))
}

/**
 * Шкала фрагментов клетками: закрашено `have` из `need`. `gain` — сколько
 * клеток только что пришло: они загораются по очереди (окно награды).
 */
export function FragmentCells({ have, need, gain = 0 }: { have: number; need: number; gain?: number }) {
  const cells = []
  for (let i = 0; i < need; i++) {
    const fresh = i >= have - gain && i < have
    cells.push(
      <i
        key={i}
        className={i < have ? (fresh ? 'on fresh' : 'on') : ''}
        style={fresh ? ({ '--wi-d': (i - (have - gain)) * 160 + 'ms' } as CSSProperties) : undefined}
      />,
    )
  }
  return <span className="wi-cells">{cells}</span>
}

/**
 * Вещь периода (две недели, срок — `endsAt` от службы): крупное превью, имя, шкала фрагментов, сколько дней осталось.
 * `compact` — полоска для плашки лобби.
 */
export function WeekItem({ item, compact = false }: { item: WeekItemData; compact?: boolean }) {
  const tone = { '--wi-tone': RARITY_TONE[item.rarity || 'EPIC'] } as CSSProperties
  const have = Math.min(item.have, item.need)
  const left = weekDaysLeft(item.endsAt)
  if (compact) {
    return (
      <span className="wi-strip" style={tone} aria-label={'Вещь двух недель: ' + have + ' из ' + item.need}>
        <span className="wi-strip-bar">
          <i style={{ width: (have / Math.max(1, item.need)) * 100 + '%' }} />
        </span>
        <b>
          {have}/{item.need}
        </b>
      </span>
    )
  }
  return (
    <div className={'wi' + (item.owned ? ' owned' : '')} style={tone}>
      <span className="wi-art">
        {item.preview ? <img src={item.preview} alt="" draggable={false} /> : null}
        {item.owned ? (
          <span className="wi-got">
            <Icon id="i-check" />
          </span>
        ) : null}
      </span>
      <span className="wi-body">
        <span className="wi-kicker">Вещь двух недель</span>
        <b className="wi-name">{item.name}</b>
        <span className="wi-prog">
          <FragmentCells have={have} need={item.need} />
          <b>
            {have}/{item.need}
          </b>
        </span>
        {left > 0 && !item.owned ? (
          <span className="wi-left">
            <Icon id="i-clock" />
            {'до конца ' + daysWord(left)}
          </span>
        ) : null}
      </span>
    </div>
  )
}
