import { Slider } from '../Slider'
import { useMusic } from '../../state/music'

/**
 * Громкость радио для Настроек. Из лобби ползунок убран: там только тумблер.
 * Вставка: `<Row icon="i-volume" title="Громкость радио"><RadioVolume /></Row>`.
 */
export function RadioVolume() {
  const level = useMusic((s) => s.level)
  const muted = useMusic((s) => s.muted)
  const setVolume = useMusic((s) => s.setVolume)
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '200px' }}>
      <span style={{ flex: 1 }}>
        <Slider value={muted ? 0 : level} min={0} max={100} onChange={setVolume} />
      </span>
      <span className="set-val" style={{ width: '38px', textAlign: 'right' }}>
        {(muted ? 0 : level) + '%'}
      </span>
    </span>
  )
}
