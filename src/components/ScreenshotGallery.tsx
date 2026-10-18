import { useCallback, useEffect, useState } from 'react'
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
  shareScreenshot,
  type Screenshot,
} from '../ipc/commands'
import { useT } from '../i18n'

interface Props {
  profile: string
}

export function ScreenshotGallery({ profile }: Props) {
  const t = useT()
  const [shots, setShots] = useState<Screenshot[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<'build' | 'all'>('build')
  const [busy, setBusy] = useState('')

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
      ) : (
        <div className="shot-grid">
          {shots.map((shot) => (
            <figure className="shot-card" key={shot.path}>
              <button className="shot-thumb" onClick={() => openImage(src(shot), { path: shot.path })} aria-label={t('Открыть')}>
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

    </>
  )
}
