import { Icon } from '../Icon'
import '../../styles/pixel/retention.css'

/** Огонёк серии как в Snapchat: огонь и число дней. Нет серии — ничего. */
export function StreakFire({ n, className }: { n: number | null | undefined; className?: string }) {
  if (!n || n < 1) return null
  return (
    <span className={'fire' + (className ? ' ' + className : '')} aria-label={'Серия ' + n}>
      <Icon id="i-flame" />
      {n}
    </span>
  )
}
