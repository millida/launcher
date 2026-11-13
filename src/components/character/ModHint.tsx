import { useEffect, useState } from 'react'
import { millidaModState, type MillidaModState } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { hasMillidaAccount } from '../../lib/api'
import { tx, useT } from '../../i18n'
import { useProfiles } from '../../state/profiles'

/** The build cannot carry our mod: what is worn here will not reach the game. */
export function noCosmeticsIn(state: MillidaModState | null): boolean {
  return !!state && !state.installed && !state.available
}

/** Why the worn items will not show up in the selected build. Says nothing while it is fine. */
export function ModHint({ on }: { on: boolean }) {
  const t = useT()
  const build = useProfiles((s) => s.selected)
  const [state, setState] = useState<{ build: string; mod: MillidaModState } | null>(null)

  useEffect(() => {
    if (!on || !build || !hasTauri() || !hasMillidaAccount()) return
    let alive = true
    millidaModState(build)
      .then((mod) => {
        if (alive) setState({ build, mod })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [on, build])

  if (!state || state.build !== build || !noCosmeticsIn(state.mod)) return null
  return (
    <span className="stage-note ch-mod-hint">
      {t('В сборке «{name}» одежда и эмоции не появятся: {reason}', {
        name: state.build,
        reason: state.mod.reason ? tx(state.mod.reason) : t('Под эту сборку мода пока нет'),
      })}
    </span>
  )
}
