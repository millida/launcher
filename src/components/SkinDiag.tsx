import { useCallback, useEffect, useState } from 'react'
import { setSkinMod, skinDiagnose } from '../ipc/commands'
import type { SkinDiag as SkinDiagReport } from '../ipc/commands'
import { backdropClose } from '../lib/dismiss'
import { copyText } from '../lib/clipboard'
import { showToast } from '../state/ui'
import { track } from '../lib/telemetry'
import { Icon } from './Icon'
import { apiErrorText } from '../lib/apiError'

const HEALTHY = new Set(['ok', 'never_launched', 'vanilla'])

const mark = (v?: boolean) => (v ? 'ок' : 'нет')

// Support reads this instead of asking for logs, so every link of both routes
// is named: "скин и плащ отдаются" used to be printed for a profile with no
// cape at all.
function serverLine(s: NonNullable<SkinDiagReport['server']>): string {
  if (!s.ok) return s.reason || 'текстуры недоступны'
  return 'скин ' + mark(s.skinReadable) + ' · плащ ' + (s.cape ? mark(s.capeReadable) : 'не выбран')
}

function sessionLine(s: NonNullable<SkinDiagReport['session']>): string {
  if (!s.profile) return 'профиль сессии не отдаётся · агент ' + mark(s.agent)
  return (
    'агент ' + mark(s.agent) + ' · подпись ' + mark(s.signed) + ' · скин ' + mark(s.skin) + ' · плащ ' + mark(s.cape) + ' · домен ' + mark(s.domainOk) + ' · текстура ' + mark(s.textureOk)
  )
}

function reportText(r: SkinDiagReport): string {
  const lines = ['=== Скин в игре · проверка ===', 'Ник: ' + r.nick, 'Вердикт: ' + r.verdict + ' — ' + r.text]
  if (r.server) lines.push('Сервер: ' + serverLine(r.server))
  if (r.session) lines.push('Аккаунт: ' + sessionLine(r.session))
  r.builds.forEach((b) => {
    lines.push('- ' + b.build + ' (' + b.mc + ' · ' + b.loader + '): ' + b.text)
    b.problems.forEach((p) => lines.push('    ' + p))
  })
  return lines.join('\n')
}

export function SkinDiag({ nick, online, onClose }: { nick: string; online: boolean; onClose: () => void }) {
  const [report, setReport] = useState<SkinDiagReport | null>(null)
  const [failed, setFailed] = useState('')
  const [fixing, setFixing] = useState(false)

  const check = useCallback(
    (alive: () => boolean) =>
      skinDiagnose(nick, online)
        .then((r) => {
          if (!alive()) return
          setReport(r)
          setFailed('')
          track('skin_diag', { verdict: r.verdict, builds: r.builds.length })
        })
        .catch((e) => {
          if (alive()) setFailed(apiErrorText(e, 'Проверка скина не прошла'))
        }),
    [nick, online],
  )

  useEffect(() => {
    let alive = true
    void check(() => alive)
    return () => {
      alive = false
    }
  }, [check])

  // The whole point of the button: the player presses it and the launcher does
  // the repair, instead of the report naming a switch in build settings.
  const repair = async (fix: NonNullable<SkinDiagReport['fix']>) => {
    setFixing(true)
    try {
      await setSkinMod(fix.build, true)
      await check(() => true)
      showToast('Мод скинов включён для сборки «' + fix.build + '» — запусти её заново')
    } catch (e) {
      showToast(apiErrorText(e, 'Не удалось включить мод скинов'), 'error')
    } finally {
      setFixing(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const fix = report?.fix || null

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
            {failed}
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
          {fix ? (
            <button className="btn md primary" disabled={fixing} onClick={() => void repair(fix)}>
              <Icon id="i-check" />
              {fixing ? 'Чиним…' : 'Починить'}
            </button>
          ) : null}
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
              Копировать отчёт
            </button>
          ) : null}
          {failed ? (
            <button
              className="btn md secondary"
              onClick={() => {
                setFailed('')
                void check(() => true)
              }}
            >
              <Icon id="i-restart" />
              Повторить
            </button>
          ) : null}
          <button className={'btn md' + (fix ? ' secondary' : ' primary')} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
