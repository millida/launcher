import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { applyCrashFix, openProfileFolder, openUrl } from '../ipc/commands'
import { copyText } from '../lib/clipboard'
import { showToast } from '../state/ui'
import { runRepair } from '../lib/repair'
import { useCrash } from '../state/crash'
import { backdropClose } from '../lib/dismiss'
import { buildCrashReport, shareCrashLog } from '../lib/crashSupport'
import { SUPPORT_URL } from '../lib/api'

const SUPPORT_ACT = 'support'

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
  // Одна главная кнопка: если ядро нашло точную причину (выключить мод,
  // сменить Java), главное действие — её исправление; общая «Починить сборку»
  // тогда вторая. Раньше точный фикс был мелкой серой кнопкой, а зелёной —
  // общая починка, которая эту причину не лечит (аудит 22.09.2026).
  const fixes = (info.actions ?? []).filter((a) => a.kind !== 'repair')
  const hasMainFix = fixes.some((a) => a.kind !== 'share-log' && a.kind !== 'open-folder')
  const mainFixKey = hasMainFix
    ? (() => {
        const a = fixes.find((x) => x.kind !== 'share-log' && x.kind !== 'open-folder')!
        return a.kind + (a.arg ?? '')
      })()
    : ''
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
              {info.profile}
            </div>
          </div>
        </div>
        <p className="crash-reason">{info.reason}</p>

        {info.tail ? (
          <>
            <button className="crash-toggle" onClick={() => setShowTail((v) => !v)}>
              <Icon id={showTail ? 'i-chev-d' : 'i-chev-r'} /> Подробности
            </button>
            {showTail ? <pre className="host-console crash-tail">{info.tail}</pre> : null}
          </>
        ) : null}

        {fixes.length ? (
          <div className={'crash-fixes' + (hasMainFix ? ' has-main' : '')}>
            {fixes.map((a) => (
                <button
                  key={a.kind + (a.arg ?? '')}
                  className={
                    a.kind + (a.arg ?? '') === mainFixKey
                      ? 'btn lg primary crash-main-fix'
                      : 'btn sm ' + (a.kind === 'share-log' ? 'ghost' : 'secondary')
                  }
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
                      shareCrashLog(info.profile)
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

        {/* Both ways out are full-width and equally loud. Support used to be no
            way out at all: the dialog offered a repair and a folder, and a
            player who could not fix it himself simply closed the window — he
            never guessed the chat on the site was an option. */}
        <div className="crash-acts">
          <button
            className={'btn lg ' + (hasMainFix ? 'secondary' : 'primary')}
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
          <button
            className="btn lg secondary"
            disabled={acting === SUPPORT_ACT}
            onClick={() => {
              if (!hasTauri()) return
              setActing(SUPPORT_ACT)
              // The chat opens even when the report could not be built: getting
              // the player to support matters more than the attachment, and the
              // toast says plainly what he will have to describe himself.
              buildCrashReport(info)
                .then((text) =>
                  copyText(text).then((copied) => {
                    openUrl(SUPPORT_URL)
                    showToast(
                      copied
                        ? 'Данные о вылете скопированы — вставь их в чат поддержки'
                        : 'Чат открыт. Скопировать данные не вышло: «Настройки → О лаунчере → Данные для поддержки»',
                      copied ? 'ok' : 'error',
                    )
                  }),
                )
                .catch((e) => {
                  openUrl(SUPPORT_URL)
                  showToast('Чат открыт, но данные о вылете собрать не вышло: ' + e, 'error')
                })
                .finally(() => setActing(''))
            }}
          >
            <Icon id="i-headset" /> {acting === SUPPORT_ACT ? 'Собираем…' : 'Поддержка'}
          </button>
          <div className="crash-acts-min">
            <button className="btn md ghost" onClick={() => hasTauri() && openProfileFolder(info.profile)}>
              <Icon id="i-folder" /> Папка
            </button>
            <button className="btn md ghost" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
