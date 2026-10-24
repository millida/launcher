import { useEffect, useRef, useState } from 'react'
import { packAutoUpdate, setPackAutoUpdate } from '../ipc/commands'
import type { PackAutoUpdate } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { t, tx, useT } from '../i18n'

export function packAutoUpdateNote(s: PackAutoUpdate): string | null {
  if (s.on && s.modified) return t('Твои изменения модов заменятся версией автора')
  if (!s.on && s.modified && s.chosen === null) return t('Выключено: ты менял моды')
  return null
}

export function PackAutoUpdateRow({ profile }: { profile: string }) {
  const t = useT()
  const [state, setState] = useState<PackAutoUpdate | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    setState(null)
    if (!hasTauri()) return
    const my = ++seq.current
    packAutoUpdate(profile)
      .then((s) => {
        if (my === seq.current) setState(s)
      })
      .catch(() => {})
  }, [profile])

  if (!state || !state.catalog) return null

  const toggle = () => {
    if (busy) return
    const next = !state.on
    const my = ++seq.current
    setBusy(true)
    setPackAutoUpdate(profile, next)
      .then((s) => {
        if (my === seq.current) setState(s)
        showToast(next ? t('Сборка будет обновляться сама') : t('Сборка обновляется только по кнопке «Обновить»'))
      })
      .catch((e) => showToast(t('Не удалось сохранить автообновление: {error}', { error: tx(e) }), 'error'))
      .finally(() => setBusy(false))
  }

  const note = packAutoUpdateNote(state)
  return (
    <div className="set-row" id="bsPackAutoUpdate">
      <span className="lab">
        {t('Автообновление сборки')}
        {note ? <small>{note}</small> : null}
      </span>
      <span
        className={'tgl' + (state.on ? ' on' : '') + (busy ? ' busy' : '')}
        data-packautoupdate={state.on ? 'on' : 'off'}
        role="switch"
        aria-checked={state.on}
        aria-label={t('Автообновление сборки')}
        onClick={toggle}
      ></span>
    </div>
  )
}
