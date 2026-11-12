import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { horizonState, horizonStateFor, setHorizon } from '../../ipc/commands'
import type { HorizonState } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { horizonFits } from '../../lib/horizon'
import { showToast } from '../../state/ui'
import { tx, useT } from '../../i18n'
import '../../styles/pixel/horizon.css'

type RowProps = { st: HorizonState; on: boolean; busy: boolean; onFlip: () => void; className: string; wholeRow?: boolean }

function HorizonRow({ st, on, busy, onFlip, className, wholeRow = false }: RowProps) {
  const t = useT()
  const usable = st.available || on
  const flip = () => usable && !busy && onFlip()
  const switchProps = {
    role: 'switch',
    'aria-checked': on,
    'aria-disabled': !usable || busy,
    'aria-label': t('Horizon (бета)'),
  } as const
  const rowSwitch = wholeRow
    ? {
        ...switchProps,
        tabIndex: usable ? 0 : -1,
        onClick: flip,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key !== ' ' && e.key !== 'Enter') return
          e.preventDefault()
          flip()
        },
      }
    : {}
  return (
    <div className={className + ' hz-row' + (usable ? '' : ' off') + (on ? ' on' : '')} {...rowSwitch}>
      <span className="lab hz-lab">
        <span className="hz-title">
          <b>Horizon</b>
          <span className="hz-badge">{t('бета')}</span>
        </span>
        <small>{st.available ? t('Без модов · нужен Vulkan') : st.reason ? tx(st.reason) : ''}</small>
      </span>
      {wholeRow ? (
        <span className={'tgl' + (on ? ' on' : '')} aria-hidden="true" />
      ) : (
        <span className={'tgl' + (on ? ' on' : '')} {...switchProps} onClick={flip} />
      )}
    </div>
  )
}

/** The new-build window: the choice is kept by the window and saved once the build exists. */
export function useHorizonFor(version: string, loader: string, open: boolean) {
  const [st, setSt] = useState<HorizonState | null>(null)
  const fits = open && horizonFits(version, loader) && hasTauri()
  useEffect(() => {
    setSt(null)
    if (!fits) return
    let alive = true
    horizonStateFor(version, loader)
      .then((s) => alive && setSt(s))
      .catch(() => alive && setSt(null))
    return () => {
      alive = false
    }
  }, [fits, version, loader])
  return fits ? st : null
}

export function HorizonNewBuildRow({ st, on, onChange }: { st: HorizonState; on: boolean; onChange: (on: boolean) => void }) {
  return <HorizonRow st={st} on={on && st.available} busy={false} onFlip={() => onChange(!on)} className="hz-new" wholeRow />
}

/** Build settings: the switch is the build's own setting in the core. */
export function HorizonBuildRow({ profile, version, loader }: { profile: string; version: string; loader: string }) {
  const t = useT()
  const [st, setSt] = useState<HorizonState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSt(null)
    if (!hasTauri()) return
    let alive = true
    horizonState(profile)
      .then((s) => alive && setSt(s))
      .catch(() => alive && setSt(null))
    return () => {
      alive = false
    }
  }, [profile, version, loader])

  if (!st || (!st.available && !st.enabled)) return null
  const flip = () => {
    setBusy(true)
    setHorizon(profile, !st.enabled)
      .then(setSt)
      .catch((e) => showToast(apiErrorText(e, t('Не удалось сохранить настройку')), 'error'))
      .finally(() => setBusy(false))
  }
  return <HorizonRow st={st} on={st.enabled} busy={busy} onFlip={flip} className="set-row" />
}
