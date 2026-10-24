import { useEffect, useRef, useState } from 'react'
import { commonShareState, setCommonShare } from '../ipc/commands'
import type { CommonShare } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { useT } from '../i18n'

type Part = keyof CommonShare

/// «Общие с другими сборками»: settings, servers and packs set once and seen in
/// every build that shares them, each by its own switch.
export function CommonShareRows({ profile }: { profile: string }) {
  const t = useT()
  const [state, setState] = useState<CommonShare | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    setState(null)
    if (!hasTauri()) return
    const my = ++seq.current
    commonShareState(profile)
      .then((s) => {
        if (my === seq.current) setState(s)
      })
      .catch((e) => console.warn('[common-share] state', e))
  }, [profile])

  if (!state) return null

  const parts: [Part, string][] = [
    ['options', t('Настройки игры')],
    ['servers', t('Список серверов')],
    ['resourcepacks', t('Ресурспаки')],
    ['shaderpacks', t('Шейдеры')],
  ]

  const toggle = (part: Part) => {
    if (busy) return
    const next = { ...state, [part]: !state[part] }
    const my = ++seq.current
    setBusy(true)
    setCommonShare(profile, next)
      .then((s) => {
        if (my === seq.current) setState(s)
        showToast(next[part] ? t('Общее с другими сборками — с этого запуска') : t('Теперь только в этой сборке'), 'ok')
      })
      .catch((e) => showToast(t('Не удалось сохранить: {error}', { error: String(e) }), 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="bx-opts-cap">{t('Общее с другими сборками')}</div>
      {parts.map(([part, label]) => (
        <div className="set-row" key={part} data-common={part}>
          <span className="lab">{label}</span>
          <span
            className={'tgl' + (state[part] ? ' on' : '') + (busy ? ' busy' : '')}
            role="switch"
            aria-checked={state[part]}
            aria-label={label}
            onClick={() => toggle(part)}
          ></span>
        </div>
      ))}
    </>
  )
}
