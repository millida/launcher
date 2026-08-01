import { useEffect } from 'react'
import { Icon } from './Icon'
import { Slider } from './Slider'
import { hasTauri } from '../ipc/tauri'
import { openMusicFolder } from '../ipc/commands'
import { useMusic } from '../state/music'
import { useWallpaper } from '../state/wallpaper'

export function MusicControls() {
  const m = useMusic()
  const silent = m.muted || m.level === 0
  const iconId = silent ? 'i-mute' : 'i-volume'
  const btnIconId = silent ? 'i-music-off' : 'i-music'
  const current = m.tracks[m.index]
  const title = current ? current.title : 'Нет треков'

  useEffect(() => {
    if (!m.open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('#musPop') || t.closest('#musBtn')) return
      m.setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [m.open])

  return (
    <>
      <button
        className="wp-btn"
        id="musBtn"
        title="Музыка"
        onClick={(e) => {
          e.stopPropagation()
          const next = !m.open
          if (next) useWallpaper.getState().setPopOpen(false)
          m.setOpen(next)
        }}
      >
        <Icon id={btnIconId} />
      </button>
      <div className={'wp-pop' + (m.open ? ' open' : '')} id="musPop" style={{ width: '278px', right: '96px' }}>
        <div className="cap">Фоновая музыка</div>

        <div className="mus-row" style={{ marginBottom: '10px' }}>
          <span className="mus-info">
            <span className="mus-title">{title}</span>
            <span className="mus-sub">
              {m.tracks.length
                ? (current?.author || 'Millida') + ' · ' + (m.index + 1) + ' из ' + m.tracks.length
                : 'Добавь mp3 в папку с музыкой'}
            </span>
          </span>
          <span className="mus-ctrl">
            <button className="mus-btn" title="Предыдущий" onClick={m.prev} disabled={m.tracks.length < 2}>
              <Icon id="i-skip-back" />
            </button>
            <button className="mus-btn main" title={m.playing ? 'Пауза' : 'Играть'} onClick={m.togglePlay}>
              <Icon id={m.playing ? 'i-pause' : 'i-play'} />
            </button>
            <button className="mus-btn" title="Следующий" onClick={m.next} disabled={m.tracks.length < 2}>
              <Icon id="i-skip-fwd" />
            </button>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 2px' }}>
          <button
            className="icon-btn"
            id="musToggle"
            onClick={(e) => {
              e.stopPropagation()
              m.toggleMute()
            }}
          >
            <Icon id={iconId} />
          </button>
          <div style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>
            <Slider value={m.level} min={0} max={100} onChange={(v) => m.setVolume(v)} />
          </div>
          <span className="set-val" id="musVal" style={{ width: '38px', textAlign: 'right' }}>
            {(m.muted ? 0 : m.level) + '%'}
          </span>
        </div>

        {m.tracks.length > 1 ? (
          <div className="mus-list">
            {m.tracks.map((t, i) => (
              <button key={t.src} className={'mus-item' + (i === m.index ? ' on' : '')} onClick={() => m.play(i)}>
                <Icon id={i === m.index && m.playing ? 'i-pause' : 'i-play'} />
                <span>{t.title}</span>
              </button>
            ))}
          </div>
        ) : null}

        {hasTauri() ? (
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button className="btn sm secondary" style={{ flex: 1 }} onClick={() => openMusicFolder()}>
              Папка с музыкой
            </button>
            <button className="btn sm ghost" title="Обновить плейлист" onClick={() => void m.refresh()}>
              <Icon id="i-restart" />
            </button>
          </div>
        ) : null}
      </div>
    </>
  )
}
