import { Icon } from '../Icon'
import { radioOn, useMusic } from '../../state/music'
import { useT } from '../../i18n'
import '../../styles/pixel/daily.css'

/**
 * Радио лобби, как в Brawl Stars: музыка либо играет, либо нет. Один тумблер
 * вместо плеера — встроенный плейлист идёт по кругу сам (docs/MUSIC.md).
 * Когда радио играет, рядом с иконкой пляшут три пиксельных столбика.
 */
export function RadioToggle() {
  const t = useT()
  const on = useMusic((s) => radioOn(s))
  const toggle = useMusic((s) => s.toggleRadio)
  return (
    <button
      className={'wp-btn radio-btn' + (on ? ' on' : '')}
      id="musBtn"
      aria-pressed={on}
      aria-label={on ? t('Выключить радио') : t('Включить радио')}
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
    >
      <Icon id={on ? 'i-music' : 'i-music-off'} />
      {t('Радио')}
      <span className="radio-eq" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </button>
  )
}
