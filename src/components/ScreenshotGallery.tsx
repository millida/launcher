import { useCallback, useEffect, useState } from 'react'
import { Icon } from './Icon'
import { agoText, fmtSize } from '../lib/format'
import { hasTauri, tauri } from '../ipc/tauri'
import { copyText } from '../lib/clipboard'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import {
  deleteScreenshot,
  openScreenshots,
  saveScreenshotAs,
  screenshotGallery,
  shareScreenshot,
  type Screenshot,
} from '../ipc/commands'

interface Props {
  profile: string
}

export function ScreenshotGallery({ profile }: Props) {
  const [shots, setShots] = useState<Screenshot[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<'build' | 'all'>('build')
  const [busy, setBusy] = useState('')
  const [zoom, setZoom] = useState<Screenshot | null>(null)

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

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [zoom])

  // convertFileSrc is the only way the webview may read a game file, and the
  // core granted these exact paths when it built the list.
  const src = (shot: Screenshot) => tauri()?.core.convertFileSrc?.(shot.path) ?? ''

  const share = (shot: Screenshot) => {
    setBusy(shot.path)
    shareScreenshot(shot.profile, shot.name)
      .then((url) => {
        void copyText(url)
        showToast('Ссылка на скриншот скопирована', 'ok')
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  return (
    <>
      <div className="segs" style={{ marginBottom: '12px', width: 'auto' }}>
        {(
          [
            ['build', 'Эта сборка'],
            ['all', 'Все сборки'],
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
          Открыть папку
        </button>
      </div>

      {loading ? (
        <p className="faint-note">Собираем галерею…</p>
      ) : shots.length === 0 ? (
        <p className="faint-note">
          Скриншотов пока нет. В игре их делает клавиша F2 — они попадут сюда сразу.
        </p>
      ) : (
        <div className="shot-grid">
          {shots.map((shot) => (
            <figure className="shot-card" key={shot.path}>
              <button className="shot-thumb" onClick={() => setZoom(shot)} title="Открыть">
                <img src={src(shot)} alt={shot.name} loading="lazy" />
              </button>
              <figcaption>
                <b>{shot.name.replace(/\.png$/i, '')}</b>
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
                  title="Поделиться ссылкой"
                  disabled={busy === shot.path}
                  onClick={() => share(shot)}
                >
                  <Icon id="i-link" />
                </button>
                <button
                  className="icon-btn"
                  title="Сохранить как…"
                  onClick={() =>
                    saveScreenshotAs(shot.profile, shot.name)
                      .then((p) => p && showToast('Сохранено', 'ok'))
                      .catch((e) => showToast('' + e, 'error'))
                  }
                >
                  <Icon id="i-download" />
                </button>
                <button
                  className="icon-btn del"
                  title="Удалить"
                  onClick={() => {
                    void uiConfirm('Удалить скриншот «' + shot.name + '»?', { confirmLabel: 'Удалить' }).then((ok) => {
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

      {zoom ? (
        <div className="modal-bg open vis shot-zoom" style={{ zIndex: 220 }} onClick={() => setZoom(null)}>
          <img src={src(zoom)} alt={zoom.name} onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </>
  )
}
