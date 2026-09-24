import { useEffect } from 'react'
import { Icon } from '../Icon'
import { usePlayStats } from '../../state/playStats'

/** Часы человеческим числом: «40 мин», «2,5 ч», «120 ч». */
export function hoursText(seconds: number): string {
  if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + ' мин'
  const h = seconds / 3600
  return (h < 10 ? Math.round(h * 10) / 10 : Math.round(h)).toLocaleString('ru-RU') + ' ч'
}

/**
 * «Ты наиграл N ч» в этой сборке и «Всего N ч» — счётчик ядра
 * (state/playStats.ts). Ноль не показываем: «0 ч» читается как упрёк, а не факт.
 * Нет сборки на компьютере — только общее.
 */
export function Hours({ build }: { build?: string | null }) {
  const stats = usePlayStats((s) => s.stats)
  const loaded = usePlayStats((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void usePlayStats.getState().refresh()
  }, [loaded])
  const here = build ? stats.builds.find((b) => b.key === build) : null
  const mine = here && here.seconds >= 60 ? here.seconds : 0
  const total = stats.total_seconds >= 60 ? stats.total_seconds : 0
  if (!mine && !total) return null
  return (
    <span className="ph-hours">
      <Icon id="i-clock" />
      {mine ? (
        <span>
          Ты наиграл <b>{hoursText(mine)}</b>
        </span>
      ) : null}
      {total ? (
        <span className="ph-hours-all">
          Всего <b>{hoursText(total)}</b>
        </span>
      ) : null}
    </span>
  )
}
