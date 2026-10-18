import { useEffect } from 'react'
import { Icon } from '../Icon'
import { usePlayStats } from '../../state/playStats'
import { intlTag, t, useT } from '../../i18n'

/** Часы человеческим числом: «40 мин», «2,5 ч», «120 ч». */
export function hoursText(seconds: number): string {
  if (seconds < 3600) return t('{n} мин', { n: Math.max(1, Math.round(seconds / 60)) })
  const h = seconds / 3600
  return t('{n} ч', { n: (h < 10 ? Math.round(h * 10) / 10 : Math.round(h)).toLocaleString(intlTag()) })
}

/** «Ты наиграл N ч» в этой сборке — счётчик ядра (state/playStats.ts). Ноль не показываем. */
export function Hours({ build }: { build?: string | null }) {
  const t = useT()
  const stats = usePlayStats((s) => s.stats)
  const loaded = usePlayStats((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void usePlayStats.getState().refresh()
  }, [loaded])
  const here = build ? stats.builds.find((b) => b.key === build) : null
  if (!here || here.seconds < 60) return null
  return (
    <span className="ph-hours">
      <Icon id="i-clock" />
      <span>
        {t('Ты наиграл')} <b>{hoursText(here.seconds)}</b>
      </span>
    </span>
  )
}
