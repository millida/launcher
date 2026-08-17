import { useEffect, useState } from 'react'
import { skinDiagnose } from '../ipc/commands'
import type { SkinDiag as SkinDiagReport } from '../ipc/commands'
import { backdropClose } from '../lib/dismiss'
import { copyText } from '../lib/clipboard'
import { showToast } from '../state/ui'
import { track } from '../lib/telemetry'
import { Icon } from './Icon'

const HEALTHY = new Set(['ok', 'never_launched', 'vanilla'])

function reportText(r: SkinDiagReport): string {
  const lines = ['=== Скин в игре · проверка ===', 'Ник: ' + r.nick, 'Вердикт: ' + r.verdict + ' — ' + r.text]
  if (r.server) lines.push('Сервер: ' + (r.server.ok ? 'скин и плащ отдаются' : r.server.reason || 'текстуры недоступны'))
  r.builds.forEach((b) => {
    lines.push('- ' + b.build + ' (' + b.mc + ' · ' + b.loader + '): ' + b.text)
    b.problems.forEach((p) => lines.push('    ' + p))
  })
  return lines.join('\n')
}

export function SkinDiag({ nick, online, onClose }: { nick: string; online: boolean; onClose: () => void }) {
  const [report, setReport] = useState<SkinDiagReport | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    let alive = true
    skinDiagnose(nick, online)
      .then((r) => {
        if (!alive) return
        setReport(r)
        track('skin_diag', { verdict: r.verdict, builds: r.builds.length })
      })
      .catch((e) => alive && setFailed(String(e).replace(/^Error:\s*/, '')))
    return () => {
      alive = false
    }
  }, [nick, online])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-bg open vis" {...backdropClose(onClose)}>
      <div className="modal mw-sm">
        <h3>Почему скина нет в игре</h3>
        {!report && !failed ? (
          <div className="sub" style={{ marginTop: '10px' }}>
            Проверяем аккаунт, сборки и наш сервер…
          </div>
        ) : null}
        {failed ? (
          <div className="sub" style={{ marginTop: '10px' }}>
            Проверка не прошла: {failed}
          </div>
        ) : null}
        {report ? (
          <>
            <div
              className="card"
              style={{
                padding: '12px 14px',
                marginTop: '12px',
                fontSize: '13px',
                lineHeight: 1.55,
                background: report.verdict === 'ok' ? 'var(--m-inset)' : 'var(--m-danger-soft, var(--m-inset))',
              }}
            >
              {report.text}
            </div>
            <div style={{ marginTop: '14px', display: 'grid', gap: '8px' }}>
              {report.builds.map((b) => (
                <div key={b.build} style={{ fontSize: '12.5px', lineHeight: 1.5 }}>
                  <b>{b.build}</b>{' '}
                  <span style={{ color: 'var(--m-fg-faint)' }}>
                    {b.mc} · {b.loader}
                  </span>
                  <div style={{ color: HEALTHY.has(b.state) ? 'var(--m-fg-muted)' : 'var(--m-danger, #e5484d)' }}>
                    {b.text}
                    {b.conflict ? ' (' + b.conflict + ')' : ''}
                  </div>
                  {b.problems.map((p) => (
                    <div key={p} style={{ color: 'var(--m-fg-faint)', fontFamily: 'monospace', fontSize: '11.5px' }}>
                      {p}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          {report ? (
            <button
              className="btn md secondary"
              onClick={() =>
                void copyText(reportText(report)).then((ok) =>
                  showToast(ok ? 'Отчёт скопирован — вставь его в поддержку' : 'Не удалось скопировать отчёт', ok ? undefined : 'error'),
                )
              }
            >
              <Icon id="i-copy" />
              Скопировать для поддержки
            </button>
          ) : null}
          <button className="btn md primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
