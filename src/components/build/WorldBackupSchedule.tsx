import { useEffect, useRef, useState } from 'react'
import { Select } from '../Select'
import { setWorldAutoBackup, worldAutoBackup, type AutoBackupMode, type WorldAutoBackup } from '../../ipc/worldBackups'
import { hasTauri } from '../../ipc/tauri'
import { DEMO_WORLD_BACKUPS, demoWorldAutoBackup } from '../../lib/demo'
import { useCloudBackups } from '../../state/cloudBackups'
import { showToast } from '../../state/ui'
import { tx, useT } from '../../i18n'
import './worldBackups.css'

const KEEP = ['3', '5', '10']

/** «Автобэкап миров» of one build: the schedule, how many automatic copies to keep, and the cloud. */
export function WorldBackupSchedule({ profile }: { profile: string }) {
  const t = useT()
  const [state, setState] = useState<WorldAutoBackup | null>(null)
  const [busy, setBusy] = useState(false)
  const cloud = useCloudBackups((s) => s.status)
  const seq = useRef(0)

  useEffect(() => {
    setState(null)
    const mine = ++seq.current
    const ask = hasTauri() ? worldAutoBackup(profile) : DEMO_WORLD_BACKUPS ? Promise.resolve(demoWorldAutoBackup()) : null
    ask
      ?.then((s) => {
        if (mine === seq.current) setState(s)
      })
      .catch((e) => {
        if (mine === seq.current) showToast(t('Не удалось прочитать настройку автобэкапа: {error}', { error: tx(e) }), 'error')
      })
  }, [profile])

  if (!state) return null

  const save = (next: WorldAutoBackup) => {
    if (busy) return
    const mine = ++seq.current
    const before = state
    setState(next)
    if (!hasTauri()) return
    setBusy(true)
    setWorldAutoBackup(profile, next)
      .then((s) => {
        if (mine === seq.current) setState(s)
      })
      .catch((e) => {
        if (mine === seq.current) setState(before)
        showToast(t('Не удалось сохранить настройку автобэкапа: {error}', { error: tx(e) }), 'error')
      })
      .finally(() => setBusy(false))
  }

  const modes = [
    { value: 'off', label: t('Выкл') },
    { value: 'exit', label: t('При выходе из игры') },
    { value: 'daily', label: t('Раз в день') },
    { value: 'weekly', label: t('Раз в неделю') },
  ]
  const plus = !!cloud?.plus
  const cloudNote = !cloud ? null : !cloud.signedIn ? t('Нужен вход в аккаунт Millida') : !plus ? t('Доступно с PLUS') : null
  const cloudOn = state.cloud && plus

  return (
    <div className="wbs" id="bsWorldAutoBackup">
      <div className="set-row">
        <span className="lab">
          {t('Автобэкап миров')}
          {state.mode !== 'off' ? <small>{t('Твои бэкапы не удаляются')}</small> : null}
        </span>
        <Select value={state.mode} width={200} options={modes} disabled={busy} onChange={(v) => save({ ...state, mode: v as AutoBackupMode })} />
      </div>
      {state.mode !== 'off' ? (
        <>
          <div className="set-row">
            <span className="lab">{t('Хранить последние')}</span>
            <Select
              value={String(state.keep)}
              width={200}
              options={KEEP.map((k) => ({ value: k, label: k }))}
              disabled={busy}
              onChange={(v) => save({ ...state, keep: Number(v) })}
            />
          </div>
          <div className="set-row">
            <span className="lab">
              {t('Загружать автобэкапы в облако')}
              {cloudNote ? <small>{cloudNote}</small> : null}
            </span>
            <span
              className={'tgl' + (cloudOn ? ' on' : '') + (busy ? ' busy' : '')}
              role="switch"
              aria-checked={cloudOn}
              aria-disabled={!plus || undefined}
              aria-label={t('Загружать автобэкапы в облако')}
              onClick={() => {
                if (plus) save({ ...state, cloud: !state.cloud })
              }}
            ></span>
          </div>
        </>
      ) : null}
    </div>
  )
}
