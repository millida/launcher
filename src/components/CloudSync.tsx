import { useCallback, useEffect, useState } from 'react'
import { apiErrorText } from '../lib/apiError'
import { Icon } from './Icon'
import { Row } from './SetKit'
import { fmtSize, whenText } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { useProfiles } from '../state/profiles'
import { cloudForget, cloudPull, cloudPush, cloudStatus, type CloudStatus } from '../ipc/commands'
import { logoutToLogin } from '../lib/session'

// The server sends an ISO date, while whenText counts in epoch seconds.
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
      .catch((e) => showToast(apiErrorText(e, 'Облако не ответило'), 'error'))
  }, [])

  useEffect(load, [load])

  const push = () => {
    setBusy('push')
    cloudPush()
      .then((s) => {
        setStatus(s)
        showToast('Сборки и настройки выгружены в облако', 'ok')
      })
      .catch((e) => showToast(apiErrorText(e, 'Облако не ответило'), 'error'))
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
        load()
      })
      .catch((e) => showToast(apiErrorText(e, 'Облако не ответило'), 'error'))
      .finally(() => setBusy(''))
  }

  if (!status) return null
  if (!status.signedIn) {
    return (
      <Row title="Сборки в облаке" hint="Нужен аккаунт Millida" keys="облако облачный профиль синхронизация сборки выгрузить забрать">
        <button className="btn sm primary" onClick={() => logoutToLogin()}>
          <Icon id="i-login" /> Войти
        </button>
      </Row>
    )
  }

  return (
    <>
      <Row
        title="Сборки в облаке"
        keys="облако облачный профиль синхронизация сборки выгрузить забрать"
        hint={
          status.hasRemote
            ? `${status.remoteProfiles} сборок · ${fmtSize(status.sizeBytes)} · ${syncedAgo(status.updatedAt)}`
            : 'Пока пусто'
        }
      >
        <button className="btn sm secondary" disabled={busy !== ''} onClick={push}>
          <Icon id="i-upload" /> {busy === 'push' ? 'Выгружаем…' : 'Выгрузить'}
        </button>
        <button
          className="btn sm secondary"
          disabled={busy !== '' || !status.hasRemote}
          onClick={() => pull(null)}
        >
          <Icon id="i-download" /> {busy === 'pull' ? 'Ставим…' : 'Забрать'}
        </button>
      </Row>

      {status.missingHere.length ? (
        <Row title="Есть в облаке, нет здесь" hint={status.missingHere.join(', ')} keys="облако поставить сборки">
          <button className="btn sm primary" disabled={busy !== ''} onClick={() => pull(status.missingHere)}>
            Поставить {status.missingHere.length}
          </button>
        </Row>
      ) : null}

      {status.missingThere.length ? (
        <Row title="Есть здесь, нет в облаке" hint={status.missingThere.join(', ')} keys="облако выгрузить сборки">
          <button className="btn sm secondary" disabled={busy !== ''} onClick={push}>
            Выгрузить
          </button>
        </Row>
      ) : null}

      {status.hasRemote ? (
        <Row title="Удалить копию из облака" hint="Сборки здесь останутся" keys="облако удалить копию">
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
                  .catch((e) => showToast(apiErrorText(e, 'Облако не ответило'), 'error'))
                  .finally(() => setBusy(''))
              })
            }}
          >
            Удалить
          </button>
        </Row>
      ) : null}
    </>
  )
}
