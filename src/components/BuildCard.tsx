import { Icon } from './Icon'
import { Cover } from './Cover'
import { LOADER_NAME, fmtPlaytime, whenText } from '../lib/format'
import { useProfiles } from '../state/profiles'
import { openBuildSettings } from '../state/instance'
import { realLaunch } from '../lib/launch'
import { useGame } from '../state/game'
import type { PlayStats } from '../ipc/commands'

type Profile = ReturnType<typeof useProfiles.getState>['profiles'][number]

export function BuildCard({
  p,
  hours,
  withLast,
}: {
  p: Profile
  hours: PlayStats['builds'][number] | null
  withLast?: boolean
}) {
  const selected = useProfiles((s) => s.selected)
  const setSelected = useProfiles((s) => s.setSelected)
  const refresh = useProfiles((s) => s.refresh)
  const running = useGame((s) => s.list).includes(p.name)

  return (
    <button
      className={'card hoverable build-card' + (p.name === selected ? ' selected' : '') + (running ? ' running' : '')}
      data-prof={p.name}
      data-sound="open"
      onClick={(e) => {
        setSelected(p.name)
        if ((e.target as HTMLElement).closest('.mini-play')) {
          void refresh()
          realLaunch(p.name)
          return
        }
        openBuildSettings(p.name)
      }}
    >
      <span className="build-cover">
        <Cover url={p.icon} />
        {running ? (
          <span className="build-run">
            <span className="run-dot"></span>
            Запущено
          </span>
        ) : null}
        <span className="mini-play" data-nosound title={running ? 'Запустить ещё одну копию' : 'Играть'}>
          <Icon id="i-play" />
        </span>
      </span>
      <span className="build-body">
        <b>{p.name}</b>
        <span className="meta">{LOADER_NAME(p) + ' · ' + p.version}</span>
        {hours ? (
          <span className="meta build-hours">
            <Icon id="i-clock" />
            {fmtPlaytime(hours.seconds) + (withLast && hours.last ? ' · ' + whenText(hours.last) : '')}
          </span>
        ) : null}
      </span>
    </button>
  )
}
