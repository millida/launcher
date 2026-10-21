import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { fmtSize } from '../../lib/format'
import { apiErrorText } from '../../lib/apiError'
import { packPreview, type PackPreview } from '../../ipc/commands'
import type { PackConfirmAnswer, PackConfirmAsk } from '../../state/party'
import { OwnJarsConsent, approvedOwnJars, needsOwnJarsConsent } from '../OwnJarsConsent'
import { t, useT } from '../../i18n'

const SOURCE: Record<string, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  millida: 'Millida',
  get unknown() {
    return t('Неизвестно')
  },
}

/**
 * Nothing from the leader's custom build is downloaded before the player has seen every
 * file it brings. Unknown files are listed too: the core refuses them at install.
 */
export function PackConfirmModal({ ask, close: answer }: { ask: PackConfirmAsk; close: (answer: PackConfirmAnswer) => void }) {
  const t = useT()
  const [preview, setPreview] = useState<PackPreview | null>(null)
  const [error, setError] = useState('')
  const [trusted, setTrusted] = useState(false)
  const close = (ok: boolean) => answer({ ok, jars: ok ? approvedOwnJars(preview, trusted) : [] })

  useEffect(() => {
    let alive = true
    packPreview(ask.code)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(apiErrorText(e, t('Не удалось прочитать сборку лидера'))))
    return () => {
      alive = false
    }
  }, [ask.code])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && answer({ ok: false, jars: [] })
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [answer])

  const mods = preview?.mods || []
  const unknown = mods.filter((m) => m.source === 'unknown').length

  return (
    <div className="room-modal-back" onClick={() => close(false)}>
      <div className="room-modal party-modal" data-section="party-pack" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-download" />
          </span>
          <b>{t('Сборка лидера: {name}', { name: ask.title })}</b>
          <button className="tb-btn" aria-label={t('Закрыть')} onClick={() => close(false)}>
            <Icon id="i-x" />
          </button>
        </div>
        {error ? (
          <div className="nb-err">
            <Icon id="i-alert" />
            <span>{error}</span>
          </div>
        ) : null}
        {preview ? (
          <>
            <span className="safety-meta">
              {[preview.game, preview.loader, t('{n} файлов', { n: mods.length }), fmtSize(preview.sizeBytes)].filter(Boolean).join(' · ')}
            </span>
            <div className="party-mods">
              {mods.map((m) => (
                <div key={m.kind + '/' + m.name} className={'party-mod' + (m.source === 'unknown' ? ' bad' : '')}>
                  <span className="party-mod-name">{m.name}</span>
                  <span className="meta">{SOURCE[m.source] || m.source}</span>
                </div>
              ))}
              {(preview.overrides || []).map((p) => (
                <div key={p} className="party-mod">
                  <span className="party-mod-name">{p}</span>
                  <span className="meta">{t('Настройка')}</span>
                </div>
              ))}
            </div>
            {unknown || (preview.dropped || []).length ? (
              <p className="faint-note">{t('Не поставим: {n} файл(ов) без проверки по каталогу', { n: unknown + (preview.dropped || []).length })}</p>
            ) : null}
            <OwnJarsConsent preview={preview} trusted={trusted} onTrusted={setTrusted} />
          </>
        ) : null}
        <div className="room-modal-acts">
          <button className="btn sm ghost" onClick={() => close(false)}>
            {t('Отмена')}
          </button>
          <button className="btn sm primary" disabled={!preview || (needsOwnJarsConsent(preview) && !trusted)} onClick={() => close(true)}>
            <Icon id="i-download" />
            {t('Поставить')}
          </button>
        </div>
      </div>
    </div>
  )
}
