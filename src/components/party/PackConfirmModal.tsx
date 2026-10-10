import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { fmtSize } from '../../lib/format'
import { apiErrorText } from '../../lib/apiError'
import { packPreview, type PackPreview } from '../../ipc/commands'
import type { PackConfirmAsk } from '../../state/party'

const SOURCE: Record<string, string> = { modrinth: 'Modrinth', curseforge: 'CurseForge', millida: 'Millida', unknown: 'Неизвестно' }

/**
 * Nothing from the leader's custom build is downloaded before the player has seen every
 * file it brings. Unknown files are listed too: the core refuses them at install.
 */
export function PackConfirmModal({ ask, close }: { ask: PackConfirmAsk; close: (ok: boolean) => void }) {
  const [preview, setPreview] = useState<PackPreview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    packPreview(ask.code)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(apiErrorText(e, 'Не удалось прочитать сборку лидера')))
    return () => {
      alive = false
    }
  }, [ask.code])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [close])

  const mods = preview?.mods || []
  const unknown = mods.filter((m) => m.source === 'unknown').length

  return (
    <div className="room-modal-back" onClick={() => close(false)}>
      <div className="room-modal party-modal" data-section="party-pack" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-download" />
          </span>
          <b>{'Сборка лидера: ' + ask.title}</b>
          <button className="tb-btn" aria-label="Закрыть" onClick={() => close(false)}>
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
              {[preview.game, preview.loader, mods.length + ' файлов', fmtSize(preview.sizeBytes)].filter(Boolean).join(' · ')}
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
                  <span className="meta">Настройка</span>
                </div>
              ))}
            </div>
            {unknown || (preview.dropped || []).length ? (
              <p className="faint-note">{'Не поставим: ' + (unknown + (preview.dropped || []).length) + ' файл(ов) без проверки по каталогу'}</p>
            ) : null}
          </>
        ) : null}
        <div className="room-modal-acts">
          <button className="btn sm ghost" onClick={() => close(false)}>
            Отмена
          </button>
          <button className="btn sm primary" disabled={!preview} onClick={() => close(true)}>
            <Icon id="i-download" />
            Поставить
          </button>
        </div>
      </div>
    </div>
  )
}
