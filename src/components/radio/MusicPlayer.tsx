import { useState, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { Slider } from '../Slider'
import { Row, Toggle, useMatch } from '../SetKit'
import { plural } from '../../lib/format'
import { radioOn, useMusic } from '../../state/music'

interface Entry {
  key: string
  title: string
  playing: boolean
  onPlay: () => void
  onRemove: () => void
}

function Source({
  title,
  hint,
  keys,
  entries,
  children,
}: {
  title: string
  hint: string
  keys: string
  entries: Entry[]
  children: ReactNode
}) {
  const shown = useMatch(title + ' ' + keys + ' ' + hint)
  if (!shown) return null
  return (
    <div className="s2-mus-src">
      <Row title={title} hint={hint || undefined} keys={keys}>
        {children}
      </Row>
      {entries.length ? (
        <div className="s2-mus-list" role="list">
          {entries.map((e) => (
            <span key={e.key} role="listitem" className={'s2-mus-item' + (e.playing ? ' on' : '')}>
              <button className="s2-mus-play" aria-label={'Играть ' + e.title} onClick={e.onPlay}>
                <Icon id={e.playing ? 'i-music' : 'i-play'} />
                <span>{e.title}</span>
              </button>
              <button className="s2-mus-x" aria-label={'Убрать ' + e.title} onClick={e.onRemove}>
                <Icon id="i-x" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function MusicPlayer() {
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
    <>
      <Row
        title="Плеер"
        hint={cur ? (live?.title || cur.title) + ' · ' + (live?.author || cur.author || 'Millida') : undefined}
        keys="музыка громкость плеер трек"
      >
        {cur ? (
          <>
            <button className="btn sm ghost" aria-label="Предыдущий трек" disabled={single} onClick={prev}>
              <Icon id="i-chev-l" />
            </button>
            <button className="btn sm ghost" aria-label="Следующий трек" disabled={single} onClick={next}>
              <Icon id="i-chev-r" />
            </button>
          </>
        ) : null}
        <div className="s2-slider">
          <Slider value={level} min={0} max={100} onChange={setVolume} />
          <span className="s2-val">{level + '%'}</span>
        </div>
      </Row>

      <Row
        title="Радио Millida"
        hint={radio ? 'Играет вместе со своей музыкой' : 'Выключено, только своя музыка'}
        keys="музыка радио плеер"
      >
        <Toggle on={radio} label="Радио Millida" onChange={() => setRadio(!radio)} />
      </Row>

      <Source
        title="Своя музыка"
        hint={
          own.length
            ? own.length + ' ' + plural(own.length, 'трек', 'трека', 'треков')
            : 'mp3, ogg, wav, m4a или flac до 100 МБ — будут играть по кругу'
        }
        keys="музыка треки файлы плеер"
        entries={own.map((t) => ({
          key: t.src,
          title: t.title,
          playing: cur?.src === t.src,
          onPlay: () => play(tracks.indexOf(t)),
          onRemove: () => void removeOwn(t.file || ''),
        }))}
      >
        <button className="btn sm primary" data-track="music_add" onClick={() => void addOwn()}>
          <Icon id="i-plus" />
          Добавить треки
        </button>
        <button className="btn sm secondary" aria-label="Открыть папку с музыкой" data-track="music_folder" onClick={openFolder}>
          <Icon id="i-folder" />
        </button>
      </Source>

      <Source
        title="По ссылке"
        hint={links.length ? links.length + ' ' + plural(links.length, 'плейлист', 'плейлиста', 'плейлистов') : ''}
        keys="музыка плейлист ссылка youtube soundcloud плеер"
        entries={links.map((l) => ({
          key: l.key,
          title: l.title,
          playing: cur?.link?.key === l.key,
          onPlay: () => play(tracks.findIndex((t) => t.link?.key === l.key)),
          onRemove: () => removeLink(l.key),
        }))}
      >
        <span className="input sm s2-mus-url">
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
      </Source>
    </>
  )
}
