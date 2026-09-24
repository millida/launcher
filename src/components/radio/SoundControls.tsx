import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { radioOn, useMusic } from '../../state/music'
import { playSound, setSoundMode, soundMode } from '../../lib/sound'
import '../../styles/pixel/daily.css'

/**
 * Две кнопки сверху лобби (правка владельца 23.09.2026): «Звуки» — звуки
 * Minecraft в интерфейсе, «Музыка» — музыка лобби. Каждая сама по себе
 * включается и выключается. Уведомления «Звуки» не глушат: пропущенное
 * сообщение друга хуже тишины кликов.
 */
export function SoundControls() {
  const music = useMusic((s) => radioOn(s))
  const toggleMusic = useMusic((s) => s.toggleRadio)
  const [ui, setUi] = useState(() => soundMode() === 'all')

  // Режим звуков меняется и в Настройках: сверяемся, когда окно снова в фокусе.
  useEffect(() => {
    const sync = () => setUi(soundMode() === 'all')
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [])

  return (
    <>
      <button
        className={'wp-btn radio-btn' + (ui ? ' on' : '')}
        aria-pressed={ui}
        aria-label={ui ? 'Выключить звуки' : 'Включить звуки'}
        data-nosound
        onClick={(e) => {
          e.stopPropagation()
          const next = !ui
          setSoundMode(next ? 'all' : 'notify')
          setUi(next)
          if (next) playSound('click')
        }}
      >
        <Icon id={ui ? 'i-volume' : 'i-mute'} />
        Звуки
      </button>
      <button
        className={'wp-btn radio-btn' + (music ? ' on' : '')}
        id="musBtn"
        aria-pressed={music}
        aria-label={music ? 'Выключить музыку' : 'Включить музыку'}
        onClick={(e) => {
          e.stopPropagation()
          toggleMusic()
        }}
      >
        <Icon id={music ? 'i-music' : 'i-music-off'} />
        Музыка
        <span className="radio-eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>
    </>
  )
}
