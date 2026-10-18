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
import { useT } from '../i18n'

// The server sends an ISO date, while whenText counts in epoch seconds.
const syncedAgo = (iso: string): string => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : whenText(Math.round(ms / 1000))
}

/// Cloud profile block for the settings screen. Everything it shows is a fact
/// from the server — count, date, size — because "synced" without numbers is
/// exactly the claim players stop believing after the first silent failure.
export function CloudSync() {
  const t = useT()
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    if (!hasTauri()) return
    cloudStatus()
      .then(setStatus)
      .catch((e) => showToast(apiErrorText(e, t('Облако не ответило')), 'error'))
  }, [])

  useEffect(load, [load])

  const push = () => {
    setBusy('push')
    cloudPush()
      .then((s) => {
        setStatus(s)
        showToast(t('Сборки и настройки выгружены в облако'), 'ok')
      })
      .catch((e) => showToast(apiErrorText(e, t('Облако не ответило')), 'error'))
      .finally(() => setBusy(''))
  }

  const pull = (only: string[] | null) => {
    setBusy('pull')
    cloudPull(only, true)
      .then((r) => {
        void useProfiles.getState().refresh()
        const parts = [
          r.installed.length ? t('поставили {n}', { n: r.installed.length }) : '',
          r.updated.length ? t('обновили {n}', { n: r.updated.length }) : '',
          r.failed.length ? t('не вышло: {n}', { n: r.failed.length }) : '',
        ].filter(Boolean)
        showToast(parts.length ? t('Сборки: {list}', { list: parts.join(', ') }) : t('Всё уже на месте'), r.failed.length ? 'error' : 'ok')
        if (r.failed.length) r.failed.slice(0, 3).forEach((f) => showToast(f, 'error'))
        load()
      })
      .catch((e) => showToast(apiErrorText(e, t('Облако не ответило')), 'error'))
      .finally(() => setBusy(''))
  }

  if (!status) return null
  if (!status.signedIn) {
    return (
      <Row title={t('Сборки в облаке')} hint={t('Нужен аккаунт Millida')} keys="облако облачный профиль синхронизация сборки выгрузить забрать">
        <button className="btn sm primary" onClick={() => logoutToLogin()}>
          <Icon id="i-login" /> {t('Войти')}
        </button>
      </Row>
    )
  }

  return (
    <>
      <Row
        title={t('Сборки в облаке')}
        keys="облако облачный профиль синхронизация сборки выгрузить забрать"
        hint={
          status.hasRemote
            ? `${t('{n} сборок', { n: status.remoteProfiles })} · ${fmtSize(status.sizeBytes)} · ${syncedAgo(status.updatedAt)}`
            : t('Пока пусто')
        }
      >
        <button className="btn sm secondary" disabled={busy !== ''} onClick={push}>
          <Icon id="i-upload" /> {busy === 'push' ? t('Выгружаем…') : t('Выгрузить')}
        </button>
        <button
          className="btn sm secondary"
          disabled={busy !== '' || !status.hasRemote}
          onClick={() => pull(null)}
        >
          <Icon id="i-download" /> {busy === 'pull' ? t('Ставим…') : t('Забрать')}
        </button>
      </Row>

      {status.missingHere.length ? (
        <Row title={t('Есть в облаке, нет здесь')} hint={status.missingHere.join(', ')} keys="облако поставить сборки">
          <button className="btn sm primary" disabled={busy !== ''} onClick={() => pull(status.missingHere)}>
            {t('Поставить {n}', { n: status.missingHere.length })}
          </button>
        </Row>
      ) : null}

      {status.missingThere.length ? (
        <Row title={t('Есть здесь, нет в облаке')} hint={status.missingThere.join(', ')} keys="облако выгрузить сборки">
          <button className="btn sm secondary" disabled={busy !== ''} onClick={push}>
            {t('Выгрузить')}
          </button>
        </Row>
      ) : null}

      {status.hasRemote ? (
        <Row title={t('Удалить копию из облака')} hint={t('Сборки здесь останутся')} keys="облако удалить копию">
          <button
            className="btn sm danger"
            disabled={busy !== ''}
            onClick={() => {
              void uiConfirm(t('Удалить облачную копию сборок и настроек?'), { confirmLabel: t('Удалить') }).then((ok) => {
                if (!ok) return
                setBusy('forget')
                cloudForget()
                  .then(() => {
                    showToast(t('Облачная копия удалена'), 'ok')
                    load()
                  })
                  .catch((e) => showToast(apiErrorText(e, t('Облако не ответило')), 'error'))
                  .finally(() => setBusy(''))
              })
            }}
          >
            {t('Удалить')}
          </button>
        </Row>
      ) : null}
    </>
  )
}
