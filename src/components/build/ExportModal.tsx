import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { exportPack } from '../../ipc/commands'
import type { ExportFormat } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { backdropClose } from '../../lib/dismiss'
import { showToast } from '../../state/ui'
import { Icon } from '../Icon'
import { useT } from '../../i18n'
import '../../styles/pixel/build-extras.css'

const FORMATS: [ExportFormat, string][] = [
  ['mrpack', 'Modrinth (.mrpack)'],
  ['curseforge', 'CurseForge (.zip)'],
  ['multimc', 'MultiMC / Prism (.zip)'],
]

export function ExportModal({ profile, ramGb, onClose }: { profile: string; ramGb: number; onClose: () => void }) {
  const t = useT()
  const [format, setFormat] = useState<ExportFormat>('mrpack')
  const [withRam, setWithRam] = useState(ramGb > 0)
  const [lock, setLock] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const run = () => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'))
      return
    }
    setBusy(true)
    exportPack(profile, format, withRam ? ramGb * 1024 : 0, lock)
      .then((p) => {
        showToast(t('Экспортировано: {file}', { file: String(p).split(/[\\/]/).pop() ?? '' }), 'ok')
        onClose()
      })
      .catch((e) => showToast(apiErrorText(e, t('Не удалось экспортировать')), 'error'))
      .finally(() => setBusy(false))
  }

  const check = (on: boolean, set: (v: boolean) => void, label: string, disabled?: boolean) => (
    <label className={'bx-check' + (disabled ? ' off' : '')} onClick={(e) => (e.preventDefault(), !disabled && set(!on))}>
      <span className={'chk' + (on ? ' on' : '')} role="checkbox" aria-checked={on} aria-disabled={disabled} />
      {label}
    </label>
  )

  return createPortal(
    <div className="modal-bg open vis" style={{ zIndex: 970 }} {...backdropClose(() => !busy && onClose())}>
      <div className="modal mw-sm">
        <h3>{t('Экспорт сборки')}</h3>
        <div className="bx-formats" role="radiogroup" aria-label={t('Формат')}>
          {FORMATS.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={format === id} className={'bx-format' + (format === id ? ' on' : '')} onClick={() => setFormat(id)}>
              {label}
            </button>
          ))}
        </div>
        {check(withRam, setWithRam, ramGb > 0 ? t('Память {n} ГБ для всех, кто поставит', { n: ramGb }) : t('Память — авто'), ramGb <= 0)}
        {check(lock, setLock, t('Запретить добавлять моды'))}
        <div className="bx-upd-acts">
          <button className="btn md secondary" disabled={busy} onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn md primary" disabled={busy} onClick={run}>
            <Icon id="i-download" /> {busy ? t('Собираем…') : t('Экспортировать')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
