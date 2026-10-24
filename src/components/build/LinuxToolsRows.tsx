import { useEffect, useState } from 'react'
import { linuxToolsState, setLinuxTools } from '../../ipc/commands'
import type { LinuxTools } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { showToast } from '../../state/ui'
import { useT } from '../../i18n'

/** GameMode and Gamescope switches; rendered only on Linux, where the core reports them as supported. */
export function LinuxToolsRows({ profile }: { profile: string }) {
  const t = useT()
  const [st, setSt] = useState<LinuxTools | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSt(null)
    if (!hasTauri()) return
    let alive = true
    linuxToolsState(profile)
      .then((s) => alive && setSt(s))
      .catch(() => alive && setSt(null))
    return () => {
      alive = false
    }
  }, [profile])

  if (!st || !st.supported) return null
  const flip = (gamemode: boolean, gamescope: boolean) => {
    setBusy(true)
    setLinuxTools(profile, gamemode, gamescope)
      .then(setSt)
      .catch((e) => showToast(apiErrorText(e, t('Не удалось сохранить настройку')), 'error'))
      .finally(() => setBusy(false))
  }
  const row = (label: string, on: boolean, installed: boolean, bin: string, toggle: () => void) => (
    <div className="set-row">
      <span className="lab">
        {label}
        {installed ? null : <small>{t('Не установлен: {bin}', { bin })}</small>}
      </span>
      <span
        className={'tgl' + (on && installed ? ' on' : '')}
        role="switch"
        aria-checked={on && installed}
        aria-disabled={!installed || busy}
        aria-label={label}
        onClick={() => installed && !busy && toggle()}
      />
    </div>
  )
  return (
    <>
      {row('GameMode', st.gamemode, st.gamemodeInstalled, 'gamemoderun', () => flip(!st.gamemode, st.gamescope))}
      {row('Gamescope', st.gamescope, st.gamescopeInstalled, 'gamescope', () => flip(st.gamemode, !st.gamescope))}
    </>
  )
}
