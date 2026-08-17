import { useCallback, useEffect, useState } from 'react'
import { Icon } from './Icon'
import { fmtSize, whenText } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { useProfiles } from '../state/profiles'
import { cloudForget, cloudPull, cloudPush, cloudStatus, type CloudStatus } from '../ipc/commands'

// ISO-дата приходит от сервера, а whenText считает в секундах эпохи
const syncedAgo = (iso: string): string => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : whenText(Math.round(ms / 1000))
}

/// Cloud profile block for the settings screen. Everything it shows is a fact
/// from the server — count, date, size — because "synced" without numbers is
/// exactly the claim players stop believing after the first silent failure.
export function CloudSync() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    if (!hasTauri()) return
    cloudStatus()
      .then(setStatus)
      .catch((e) => showToast('' + e, 'error'))
  }, [])

  useEffect(load, [load])

  const push = () => {
    setBusy('push')
    cloudPush()
      .then((s) => {
        setStatus(s)
        showToast('Сборки и настройки выгружены в облако', 'ok')
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  const pull = (only: string[] | null) => {
    setBusy('pull')
    cloudPull(only, true)
      .then((r) => {
        void useProfiles.getState().refresh()
        const parts = [
          r.installed.length ? 'поставили ' + r.installed.length : '',
          r.updated.length ? 'обновили ' + r.updated.length : '',
          r.failed.length ? 'не вышло: ' + r.failed.length : '',
        ].filter(Boolean)
        showToast(parts.length ? 'Сборки: ' + parts.join(', ') : 'Всё уже на месте', r.failed.length ? 'error' : 'ok')
        if (r.failed.length) r.failed.slice(0, 3).forEach((f) => showToast(f, 'error'))
        if (r.themesMissing.length) showToast('Темы из облака ещё не установлены: ' + r.themesMissing.join(', '))
        load()
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  if (!status) return null
  if (!status.signedIn) {
    return (
      <div className="set-row">
        <span className="lab">
          Облачный профиль<small>Войди в аккаунт Millida — и сборки будут на любом компьютере</small>
        </span>
        <span className="set-val">Нужен вход</span>
      </div>
    )
  }

  return (
    <>
      <div className="set-row">
        <span className="lab">
          Облачный профиль
          <small>
            {status.hasRemote
              ? `В облаке ${status.remoteProfiles} сборок · ${fmtSize(status.sizeBytes)} · ${status.device || 'другой компьютер'} · ${syncedAgo(status.updatedAt)}`
              : 'В облаке пока пусто — выгрузи сборки, чтобы поднять их на другом компьютере'}
          </small>
        </span>
        <button className="btn sm secondary" disabled={busy !== ''} onClick={push}>
          <Icon id="i-upload" /> {busy === 'push' ? 'Выгружаем…' : 'Выгрузить'}
        </button>
        <button
          className="btn sm secondary"
          disabled={busy !== '' || !status.hasRemote}
          onClick={() => pull(null)}
          title="Поставит сборки, которых на этом компьютере нет"
        >
          <Icon id="i-download" /> {busy === 'pull' ? 'Ставим…' : 'Забрать'}
        </button>
      </div>

      {status.missingHere.length ? (
        <div className="set-row">
          <span className="lab">
            Есть в облаке, нет здесь<small>{status.missingHere.join(', ')}</small>
          </span>
          <button className="btn sm primary" disabled={busy !== ''} onClick={() => pull(status.missingHere)}>
            Поставить {status.missingHere.length}
          </button>
        </div>
      ) : null}

      {status.missingThere.length ? (
        <div className="set-row">
          <span className="lab">
            Есть здесь, нет в облаке<small>{status.missingThere.join(', ')}</small>
          </span>
          <button className="btn sm secondary" disabled={busy !== ''} onClick={push}>
            Выгрузить
          </button>
        </div>
      ) : null}

      {status.hasRemote ? (
        <div className="set-row">
          <span className="lab">
            Удалить копию из облака<small>Сборки на этом компьютере останутся на месте</small>
          </span>
          <button
            className="btn sm danger"
            disabled={busy !== ''}
            onClick={() => {
              void uiConfirm('Удалить облачную копию сборок и настроек?', { confirmLabel: 'Удалить' }).then((ok) => {
                if (!ok) return
                setBusy('forget')
                cloudForget()
                  .then(() => {
                    showToast('Облачная копия удалена', 'ok')
                    load()
                  })
                  .catch((e) => showToast('' + e, 'error'))
                  .finally(() => setBusy(''))
              })
            }}
          >
            Удалить
          </button>
        </div>
      ) : null}
    </>
  )
}
