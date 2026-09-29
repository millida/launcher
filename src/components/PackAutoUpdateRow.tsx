import { useEffect, useRef, useState } from 'react'
import { packAutoUpdate, setPackAutoUpdate } from '../ipc/commands'
import type { PackAutoUpdate } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'

export function packAutoUpdateNote(s: PackAutoUpdate): string | null {
  if (s.on && s.modified) return 'Твои изменения модов заменятся версией автора'
  if (!s.on && s.modified && s.chosen === null) return 'Выключено: ты менял моды'
  return null
}

export function PackAutoUpdateRow({ profile }: { profile: string }) {
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
        showToast(next ? 'Сборка будет обновляться сама' : 'Сборка обновляется только по кнопке «Обновить»')
      })
      .catch((e) => showToast('Не удалось сохранить автообновление: ' + e, 'error'))
      .finally(() => setBusy(false))
  }

  const note = packAutoUpdateNote(state)
  return (
    <div className="set-row" id="bsPackAutoUpdate">
      <span className="lab">
        Автообновление сборки
        {note ? <small>{note}</small> : null}
      </span>
      <span
        className={'tgl' + (state.on ? ' on' : '') + (busy ? ' busy' : '')}
        data-packautoupdate={state.on ? 'on' : 'off'}
        role="switch"
        aria-checked={state.on}
        aria-label="Автообновление сборки"
        onClick={toggle}
      ></span>
    </div>
  )
}
