import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { fmtSize } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { backdropClose } from '../lib/dismiss'
import { showToast } from '../state/ui'
import { useProfiles } from '../state/profiles'
import { installSharedPack, packPreview, type PackPreview } from '../ipc/commands'

interface Props {
  onClose: () => void
  initialCode?: string
}

/// Installing a build somebody shared. The preview step is deliberate: a code
/// from a chat should say what it will install before it installs it.
export function InstallByCodeModal({ onClose, initialCode = '' }: Props) {
  const [code, setCode] = useState(initialCode)
  const [preview, setPreview] = useState<PackPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const look = (value: string) => {
    if (!hasTauri()) return
    setBusy(true)
    setError('')
    packPreview(value)
      .then(setPreview)
      .catch((e) => setError('' + e))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    if (initialCode) look(initialCode)
    // Only the code handed in by a deep link opens the preview by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode])

  const install = () => {
    if (!preview) return
    setBusy(true)
    installSharedPack(preview.code)
      .then((p) => {
        showToast('Сборка «' + p.name + '» установлена', 'ok')
        void useProfiles.getState().refresh()
        onClose()
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="modal-bg open vis" {...backdropClose(onClose)}>
      <div className="modal mw-sm">
        <div className="crash-head">
          <span className="crash-ic ok">
            <Icon id="i-download" />
          </span>
          <div>
            <h3>Сборка по коду</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              Код или ссылка от друга
            </div>
          </div>
        </div>

        <div className="wm-row">
          <div className="input sm" style={{ flex: 1 }}>
            <input
              autoFocus
              placeholder="AB23-CD45"
              value={code}
              maxLength={64}
              onChange={(e) => {
                setCode(e.target.value)
                setPreview(null)
                setError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && look(code)}
            />
          </div>
          <button className="btn sm secondary" disabled={busy || !code.trim()} onClick={() => look(code)}>
            Найти
          </button>
        </div>

        {error ? <p className="faint-note">{error}</p> : null}

        {preview ? (
          <div className="pack-preview">
            <b>{preview.name}</b>
            <span className="safety-meta">
              {[
                preview.game,
                preview.loader,
                preview.files + ' файлов',
                fmtSize(preview.sizeBytes),
                preview.author ? 'от ' + preview.author : '',
                preview.installs ? preview.installs + ' установок' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {preview.summary ? <p className="safety-why">{preview.summary}</p> : null}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          <button className="btn md primary" style={{ flex: 1 }} disabled={!preview || busy} onClick={install}>
            {busy ? 'Ставим…' : 'Установить'}
          </button>
          <button className="btn md secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
