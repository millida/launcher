import { useEffect, useRef, useState } from 'react'
import { setShaders, shadersState } from '../ipc/commands'
import type { ShadersState } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { useT } from '../i18n'

/// «Шейдеры» in a build's settings: Sodium, Iris and a light pack in one switch,
/// offered as the replacement for OptiFine.
export function ShadersRow({ profile, onChange }: { profile: string; onChange: () => void }) {
  const t = useT()
  const [state, setState] = useState<ShadersState | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    setState(null)
    if (!hasTauri()) return
    const my = ++seq.current
    shadersState(profile)
      .then((s) => {
        if (my === seq.current) setState(s)
      })
      .catch((e) => console.warn('[shaders] state', e))
  }, [profile])

  if (!state || (!state.enabled && (!state.supported || !state.applicable))) return null

  const toggle = () => {
    if (busy) return
    const next = !state.enabled
    const my = ++seq.current
    setBusy(true)
    setShaders(profile, next)
      .then((s) => {
        if (my === seq.current) setState(s)
        onChange()
        showToast(next ? t('Шейдеры включены — они уже выбраны в игре') : t('Шейдеры выключены, их моды сняты'), 'ok', next ? 'achievement' : undefined)
      })
      .catch((e) => showToast(t('Не удалось переключить шейдеры: {error}', { error: String(e) }), 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="set-row" id="bsShaders">
      <span className="lab">
        {t('Шейдеры')}
        <small>{state.optifine && !state.enabled ? t('Сначала убери OptiFine из сборки') : t('Sodium + Iris — замена OptiFine')}</small>
      </span>
      <span
        className={'tgl' + (state.enabled ? ' on' : '') + (busy ? ' busy' : '')}
        data-shaders={state.enabled ? 'on' : 'off'}
        role="switch"
        aria-checked={state.enabled}
        aria-label={t('Шейдеры')}
        onClick={toggle}
      ></span>
    </div>
  )
}
