import { Icon } from '../Icon'
import { Slider } from '../Slider'
import { Toggle } from '../SetKit'
import { radioOn, useMusic } from '../../state/music'

export function MusicCard() {
  const level = useMusic((s) => s.level)
  const setVolume = useMusic((s) => s.setVolume)
  const tracks = useMusic((s) => s.tracks)
  const index = useMusic((s) => s.index)
  const on = useMusic((s) => radioOn(s))
  const radio = useMusic((s) => s.radio)
  const own = useMusic((s) => s.own)
  const { prev, next, play, setRadio, addOwn, removeOwn, openFolder } = useMusic.getState()
  const cur = on ? tracks[index] : undefined

  return (
    <span className="lb-vol-card lb-mus-card">
      <span className="lb-mus-vol">
        <span>
          <Slider value={level} min={0} max={100} onChange={setVolume} />
        </span>
        <b>{level + '%'}</b>
      </span>

      {cur ? (
        <span className="lb-mus-now">
          <span className="lb-mus-now-txt">
            <b>{cur.title}</b>
            <i>{cur.author || 'Millida'}</i>
          </span>
          <button className="lb-mus-ico" aria-label="Предыдущий трек" disabled={tracks.length < 2} onClick={prev}>
            <Icon id="i-chev-l" />
          </button>
          <button className="lb-mus-ico" aria-label="Следующий трек" disabled={tracks.length < 2} onClick={next}>
            <Icon id="i-chev-r" />
          </button>
        </span>
      ) : null}

      <span className="lb-mus-row">
        <span className="lb-mus-row-txt">
          <b>Радио Millida</b>
          <i>{radio ? 'Играет вместе со своей музыкой' : 'Выключено, только своя музыка'}</i>
        </span>
        <Toggle on={radio} label="Радио Millida" onChange={() => setRadio(!radio)} />
      </span>

      <span className="lb-mus-head">
        Своя музыка
        {own.length ? <i>{own.length}</i> : null}
      </span>
      {own.length ? (
        <span className="lb-mus-list" role="list">
          {own.map((t) => {
            const playing = cur?.src === t.src
            return (
              <span key={t.src} role="listitem" className={'lb-mus-item' + (playing ? ' on' : '')}>
                <button className="lb-mus-play" aria-label={'Играть ' + t.title} onClick={() => play(tracks.indexOf(t))}>
                  <Icon id={playing ? 'i-music' : 'i-play'} />
                  <span>{t.title}</span>
                </button>
                <button className="lb-mus-ico" aria-label={'Убрать ' + t.title} onClick={() => void removeOwn(t.file || '')}>
                  <Icon id="i-x" />
                </button>
              </span>
            )
          })}
        </span>
      ) : (
        <span className="lb-mus-empty">mp3, ogg, wav, m4a или flac до 100 МБ — будут играть по кругу</span>
      )}

      <span className="lb-mus-actions">
        <button className="btn sm primary" data-track="music_add" onClick={() => void addOwn()}>
          <Icon id="i-plus" />
          Добавить треки
        </button>
        <button className="btn sm secondary" aria-label="Открыть папку с музыкой" data-track="music_folder" onClick={openFolder}>
          <Icon id="i-folder" />
        </button>
      </span>
    </span>
  )
}
