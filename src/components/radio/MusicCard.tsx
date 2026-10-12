import { useState } from 'react'
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
  const links = useMusic((s) => s.links)
  const now = useMusic((s) => s.now)
  const [url, setUrl] = useState('')
  const { prev, next, play, setRadio, addOwn, removeOwn, addLink, removeLink, openFolder } = useMusic.getState()
  const cur = on ? tracks[index] : undefined
  const live = cur?.link ? now : null
  const single = tracks.length < 2 && !cur?.link
  const submitLink = () => {
    if (url.trim() && addLink(url)) setUrl('')
  }

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
            <b>{live?.title || cur.title}</b>
            <i>{live?.author || cur.author || 'Millida'}</i>
          </span>
          <button className="lb-mus-ico" aria-label="Предыдущий трек" disabled={single} onClick={prev}>
            <Icon id="i-chev-l" />
          </button>
          <button className="lb-mus-ico" aria-label="Следующий трек" disabled={single} onClick={next}>
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

      <span className="lb-mus-head">
        По ссылке
        {links.length ? <i>{links.length}</i> : null}
      </span>
      {links.length ? (
        <span className="lb-mus-list" role="list">
          {links.map((l) => {
            const playing = cur?.link?.key === l.key
            return (
              <span key={l.key} role="listitem" className={'lb-mus-item' + (playing ? ' on' : '')}>
                <button
                  className="lb-mus-play"
                  aria-label={'Играть ' + l.title}
                  onClick={() => play(tracks.findIndex((t) => t.link?.key === l.key))}
                >
                  <Icon id={playing ? 'i-music' : 'i-play'} />
                  <span>{l.title}</span>
                </button>
                <button className="lb-mus-ico" aria-label={'Убрать ' + l.title} onClick={() => removeLink(l.key)}>
                  <Icon id="i-x" />
                </button>
              </span>
            )
          })}
        </span>
      ) : null}
      <span className="lb-mus-link">
        <span className="input sm">
          <input
            aria-label="Ссылка на плейлист"
            placeholder="YouTube или SoundCloud"
            value={url}
            maxLength={2048}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitLink()
            }}
          />
        </span>
        <button className="btn sm secondary" aria-label="Добавить плейлист по ссылке" data-track="music_link_add" disabled={!url.trim()} onClick={submitLink}>
          <Icon id="i-plus" />
        </button>
      </span>
    </span>
  )
}
