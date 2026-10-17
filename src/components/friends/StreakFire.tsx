import { Icon } from '../Icon'
import '../../styles/pixel/retention.css'
import { useT } from '../../i18n'

/** Огонёк серии как в Snapchat: огонь и число дней. Нет серии — ничего. */
export function StreakFire({ n, className }: { n: number | null | undefined; className?: string }) {
  const t = useT()
  if (!n || n < 1) return null
  return (
    <span className={'fire' + (className ? ' ' + className : '')} aria-label={t('Серия {n}', { n })}>
      <Icon id="i-flame" />
      {n}
    </span>
  )
}
