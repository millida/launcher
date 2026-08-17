import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { applyCrashFix, openProfileFolder, openUrl, shareLog, listLogs } from '../ipc/commands'
import { copyText } from '../lib/clipboard'
import { showToast } from '../state/ui'
import { runRepair } from '../lib/repair'
import { useCrash } from '../state/crash'
import { backdropClose } from '../lib/dismiss'

export function CrashModal() {
  const { info, close } = useCrash()
  const [showTail, setShowTail] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [acting, setActing] = useState('')

  useEffect(() => {
    if (!info) return
    setShowTail(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [info, close])

  if (!info) return null
  return (
    <div
      className="modal-bg open vis"
      style={{ zIndex: 210 }}
      {...backdropClose(close)}
    >
      <div className="modal mw-sm">
        <div className="crash-head">
          <span className="crash-ic">
            <Icon id="i-alert" />
          </span>
          <div>
            <h3>Игра вылетела</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              Сборка «{info.profile}»
            </div>
          </div>
        </div>
        <p className="crash-reason">{info.reason}</p>

        {info.tail ? (
          <>
            <button className="crash-toggle" onClick={() => setShowTail((v) => !v)}>
              <Icon id={showTail ? 'i-chev-d' : 'i-chev-r'} /> {showTail ? 'Скрыть детали' : 'Показать детали лога'}
            </button>
            {showTail ? <pre className="host-console crash-tail">{info.tail}</pre> : null}
          </>
        ) : null}

        {(info.actions ?? []).filter((a) => a.kind !== 'repair').length ? (
          <div className="crash-fixes">
            {(info.actions ?? [])
              .filter((a) => a.kind !== 'repair')
              .map((a) => (
                <button
                  key={a.kind + (a.arg ?? '')}
                  className={'btn sm ' + (a.kind === 'share-log' ? 'ghost' : 'secondary')}
                  title={a.hint}
                  disabled={acting !== ''}
                  onClick={() => {
                    if (!hasTauri()) return
                    const key = a.kind + (a.arg ?? '')
                    setActing(key)
                    const done = (msg: string) => {
                      showToast(msg, 'ok')
                      setActing('')
                    }
                    const failed = (e: unknown) => {
                      showToast('' + e, 'error')
                      setActing('')
                    }
                    if (a.kind === 'open-url') {
                      openUrl(a.arg ?? '')
                      setActing('')
                      return
                    }
                    if (a.kind === 'open-folder') {
                      openProfileFolder(info.profile)
                      setActing('')
                      return
                    }
                    if (a.kind === 'share-log') {
                      // Свежий лог — первый в списке: именно он описывает это падение.
                      listLogs(info.profile)
                        .then((files) => {
                          const file = files.find((f) => f.startsWith('logs/')) ?? files[0]
                          if (!file) throw new Error('Лога от этого запуска нет')
                          return shareLog(info.profile, file)
                        })
                        .then((url) => {
                          void copyText(url)
                          done('Ссылка на лог скопирована')
                        })
                        .catch(failed)
                      return
                    }
                    applyCrashFix(info.profile, a.kind, a.arg ?? '')
                      .then(done)
                      .catch(failed)
                  }}
                >
                  {acting === a.kind + (a.arg ?? '') ? 'Делаем…' : a.label}
                </button>
              ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          <button
            className="btn md primary"
            style={{ flex: 1 }}
            disabled={repairing}
            onClick={() => {
              if (!hasTauri()) return
              setRepairing(true)
              // The dialog closes only on a repair that actually finished: on a
              // failure the log and the folder button stay one click away.
              runRepair(info.profile)
                .then((r) => {
                  if (r) close()
                })
                .finally(() => setRepairing(false))
            }}
          >
            <Icon id="i-restart" /> {repairing ? 'Чиним…' : 'Починить сборку'}
          </button>
          <button className="btn md secondary" onClick={() => hasTauri() && openProfileFolder(info.profile)}>
            Открыть папку
          </button>
          <button className="btn md secondary" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
