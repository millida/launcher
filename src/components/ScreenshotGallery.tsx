import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { agoText, fmtSize } from '../lib/format'
import { hasTauri, tauri } from '../ipc/tauri'
import { copyText } from '../lib/clipboard'
import { openImage } from './ImageLightbox'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import {
  deleteScreenshot,
  openScreenshots,
  saveScreenshotAs,
  screenshotGallery,
  setScreenshotNote,
  shareScreenshot,
  type Screenshot,
} from '../ipc/commands'
import { useT } from '../i18n'
import { ShotCrop } from './ShotCrop'
import { filterShots, shotAlbums } from '../lib/shotFilter'

interface Props {
  profile: string
}

export function ScreenshotGallery({ profile }: Props) {
  const t = useT()
  const [shots, setShots] = useState<Screenshot[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<'build' | 'all'>('build')
  const [busy, setBusy] = useState('')
  const [query, setQuery] = useState('')
  const [album, setAlbum] = useState('')
  const [editing, setEditing] = useState<{ path: string; caption: string; album: string } | null>(null)
  const [cropping, setCropping] = useState<Screenshot | null>(null)
  const albums = useMemo(() => shotAlbums(shots), [shots])
  const shown = useMemo(() => filterShots(shots, query, album), [shots, query, album])

  const saveNote = (shot: Screenshot) => {
    if (!editing) return
    setBusy(shot.path)
    setScreenshotNote(shot.profile, shot.name, editing.caption, editing.album)
      .then((note) => {
        setShots((list) => list.map((x) => (x.path === shot.path ? { ...x, caption: note.caption, album: note.album } : x)))
        setEditing(null)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  const load = useCallback(() => {
    if (!hasTauri()) {
      setLoading(false)
      return
    }
    setLoading(true)
    screenshotGallery(scope === 'all' ? '' : profile)
      .then(setShots)
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setLoading(false))
  }, [profile, scope])

  useEffect(load, [load])

  // convertFileSrc is the only way the webview may read a game file, and the
  // core granted these exact paths when it built the list.
  const src = (shot: Screenshot) => tauri()?.core.convertFileSrc?.(shot.path) ?? ''

  const share = (shot: Screenshot) => {
    setBusy(shot.path)
    shareScreenshot(shot.profile, shot.name)
      .then((url) => {
        void copyText(url)
        showToast(t('Ссылка на скриншот скопирована'), 'ok')
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  return (
    <>
      <div className="segs" style={{ marginBottom: '12px', width: 'auto' }}>
        {(
          [
            ['build', t('Эта сборка')],
            ['all', t('Все сборки')],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={'seg' + (scope === k ? ' on' : '')}
            style={{ height: '32px', fontSize: '12.5px' }}
            onClick={() => setScope(k)}
          >
            {label}
          </button>
        ))}
        <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => openScreenshots(profile)}>
          <Icon id="i-folder" /> {t('Папка')}
        </button>
      </div>

      {shots.length > 0 ? (
        <div className="shot-tools">
          <div className="input sm shot-search">
            <Icon id="i-search" />
            <input
              placeholder={t('Поиск по имени и подписи')}
              aria-label={t('Поиск по имени и подписи')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {albums.length ? (
            <div className="segs shot-albums" role="tablist" aria-label={t('Альбомы')}>
              {['', ...albums].map((a) => (
                <button key={a || '*'} role="tab" aria-selected={album === a} className={'seg' + (album === a ? ' on' : '')} onClick={() => setAlbum(a)}>
                  {a || t('Все')}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="shot-grid" aria-busy="true">
          <span className="skel bx-skel-shot" />
          <span className="skel bx-skel-shot" />
          <span className="skel bx-skel-shot" />
        </div>
      ) : shots.length === 0 ? (
        <div className="bx-mini-empty">
          <Icon id="i-cam" />
          <b>{t('Скриншотов пока нет')}</b>
          <span>
            {t('В игре жми')} <kbd className="bx-kbd">F2</kbd>
          </span>
        </div>
      ) : shown.length === 0 ? (
        <div className="bx-mini-empty">
          <Icon id="i-search" />
          <b>{t('Ничего не нашлось')}</b>
        </div>
      ) : (
        <div className="shot-grid">
          {shown.map((shot) => (
            <figure className="shot-card" key={shot.path}>
              <button className="shot-thumb" onClick={() => openImage(src(shot), { path: shot.path })} aria-label={t('Открыть')}>
                <img src={src(shot)} alt={shot.name} loading="lazy" />
              </button>
              <figcaption>
                {editing?.path === shot.path ? (
                  <form
                    className="shot-note"
                    onSubmit={(e) => {
                      e.preventDefault()
                      saveNote(shot)
                    }}
                  >
                    <input
                      className="input sm"
                      autoFocus
                      maxLength={200}
                      placeholder={t('Подпись')}
                      aria-label={t('Подпись')}
                      value={editing.caption}
                      onChange={(e) => setEditing({ ...editing, caption: e.target.value })}
                    />
                    <input
                      className="input sm"
                      maxLength={40}
                      list="shotAlbums"
                      placeholder={t('Альбом')}
                      aria-label={t('Альбом')}
                      value={editing.album}
                      onChange={(e) => setEditing({ ...editing, album: e.target.value })}
                    />
                    <datalist id="shotAlbums">
                      {albums.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                    <span className="shot-note-acts">
                      <button type="button" className="btn sm secondary" onClick={() => setEditing(null)}>
                        {t('Отмена')}
                      </button>
                      <button type="submit" className="btn sm primary" disabled={busy === shot.path}>
                        {t('Сохранить')}
                      </button>
                    </span>
                  </form>
                ) : null}
                <b>{shot.caption || shot.name.replace(/\.png$/i, '')}</b>
                {shot.album ? <span className="shot-album">{shot.album}</span> : null}
                <span>
                  {[
                    agoText(shot.takenAt),
                    shot.width ? shot.width + '×' + shot.height : '',
                    fmtSize(shot.sizeBytes),
                    scope === 'all' ? shot.profile : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </figcaption>
              <div className="shot-acts">
                <button
                  className="icon-btn"
                  aria-label={t('Подпись и альбом')}
                  onClick={() => setEditing({ path: shot.path, caption: shot.caption || '', album: shot.album || '' })}
                >
                  <Icon id="i-edit" />
                </button>
                <button className="icon-btn" aria-label={t('Обрезать')} onClick={() => setCropping(shot)}>
                  <Icon id="i-image" />
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('Поделиться ссылкой')}
                  disabled={busy === shot.path}
                  onClick={() => share(shot)}
                >
                  <Icon id="i-link" />
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('Сохранить как…')}
                  onClick={() =>
                    saveScreenshotAs(shot.profile, shot.name)
                      .then((p) => p && showToast(t('Сохранено'), 'ok'))
                      .catch((e) => showToast('' + e, 'error'))
                  }
                >
                  <Icon id="i-download" />
                </button>
                <button
                  className="icon-btn del"
                  aria-label={t('Удалить')}
                  onClick={() => {
                    void uiConfirm(t('Удалить скриншот «{name}»?', { name: shot.name }), { confirmLabel: t('Удалить') }).then((ok) => {
                      if (!ok) return
                      deleteScreenshot(shot.profile, shot.name)
                        .then(load)
                        .catch((e) => showToast('' + e, 'error'))
                    })
                  }}
                >
                  <Icon id="i-trash" />
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      {cropping ? <ShotCrop shot={cropping} src={src(cropping)} onClose={() => setCropping(null)} onSaved={load} /> : null}
    </>
  )
}
