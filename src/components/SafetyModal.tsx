import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { fmtSize } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { backdropClose } from '../lib/dismiss'
import { showToast } from '../state/ui'
import { quarantineMods, scanModSafety, type ModVerdict, type SafetyReport } from '../ipc/commands'

const VERDICTS: Record<ModVerdict['verdict'], { label: string; tone: string; help: string }> = {
  blocked: {
    label: 'Опасный',
    tone: 'danger',
    help: 'В списке вредоносных — убери из сборки',
  },
  suspicious: {
    label: 'Подозрительный',
    tone: 'warn',
    help: 'Внутри лишнее — проверь, откуда файл',
  },
  unknown: {
    label: 'Неизвестный',
    tone: '',
    help: 'Нет в каталогах',
  },
  ok: { label: 'Из каталога', tone: 'ok', help: 'Совпадает с Modrinth или CurseForge' },
}

interface Props {
  profile: string
  onClose: () => void
  onChanged: () => void
}

export function SafetyModal({ profile, onClose, onChanged }: Props) {
  const [report, setReport] = useState<SafetyReport | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const scan = () => {
    if (!hasTauri()) return
    setBusy(true)
    setError('')
    scanModSafety(profile)
      .then(setReport)
      .catch((e) => {
        console.error('scanModSafety', e)
        setError('' + e)
      })
      .finally(() => setBusy(false))
  }

  useEffect(scan, [profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const risky = (report?.items ?? []).filter(
    (i) => (i.verdict === 'blocked' || i.verdict === 'suspicious') && i.enabled,
  )

  const disableRisky = () => {
    setBusy(true)
    quarantineMods(
      profile,
      risky.map((i) => i.file),
    )
      .then((n) => {
        showToast(n + ' файлов отключено', 'ok')
        onChanged()
        return scanModSafety(profile).then(setReport)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="modal-bg open vis" style={{ zIndex: 215 }} {...backdropClose(onClose)}>
      <div className="modal mw-md safety-modal">
        <div className="crash-head">
          <span className="crash-ic ok">
            <Icon id="i-shield" />
          </span>
          <div>
            <h3>Проверка модов</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              {profile}
            </div>
          </div>
        </div>

        {busy && !report ? (
          <div className="bx-skel-list" aria-busy="true">
            <span className="skel" />
            <span className="skel" />
            <span className="skel" />
          </div>
        ) : error ? (
          <div className="bx-mini-empty">
            <Icon id="i-alert" />
            <b>Проверка не удалась</b>
            <button className="btn sm secondary" onClick={scan}>
              <Icon id="i-restart" /> Повторить
            </button>
          </div>
        ) : report ? (
          <>
            <div className="safety-sum">
              <span className="safety-pill ok">{report.ok} из каталога</span>
              <span className="safety-pill">{report.unknown} неизвестных</span>
              {report.suspicious ? (
                <span className="safety-pill warn">{report.suspicious} подозрительных</span>
              ) : null}
              {report.blocked ? <span className="safety-pill danger">{report.blocked} опасных</span> : null}
            </div>
            {report.note ? <p className="faint-note">{report.note}</p> : null}
            {report.checked === 0 ? <p className="faint-note">Модов нет</p> : null}

            <div className="safety-list">
              {report.items.map((item) => {
                const v = VERDICTS[item.verdict]
                return (
                  <div className={'safety-row ' + (v.tone || 'plain')} key={item.file}>
                    <span className="safety-mark">{v.label}</span>
                    <span className="safety-body">
                      <b>
                        {item.title}
                        {item.enabled ? null : <span className="wm-tag">выключён</span>}
                      </b>
                      <span className="safety-meta">
                        {[item.file, fmtSize(item.size), item.source].filter(Boolean).join(' · ')}
                      </span>
                      {item.reasons.length ? (
                        <span className="safety-why">{item.reasons.join('. ')}</span>
                      ) : (
                        <span className="safety-why">{v.help}</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          {risky.length ? (
            <button className="btn md danger" style={{ flex: 1 }} disabled={busy} onClick={disableRisky}>
              <Icon id="i-ban" /> Отключить ({risky.length})
            </button>
          ) : null}
          <button className="btn md secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
