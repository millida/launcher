import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { ContextMenu } from '../ContextMenu'
import { useProfiles } from '../../state/profiles'
import { joinWithAuth, showLaunchError } from '../../lib/launch'
import { recentPlays } from '../../lib/recentPlay'
import { useT } from '../../i18n'

/// The arrow on «Играть»: the last worlds and servers, straight back in.
export function RecentPlayButton() {
  const t = useT()
  const builds = useProfiles((s) => s.profiles)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const list = recentPlays(builds.map((b) => b.name))
  if (!list.length) return null
  return (
    <>
      <button
        className="play-recent"
        aria-label={t('Последние миры и серверы')}
        aria-expanded={!!menu}
        data-track="play_recent"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu(menu ? null : { x: r.right - 260, y: r.bottom + 4 })
        }}
      >
        <Icon id="i-chev-d" />
      </button>
      {menu
        ? createPortal(
            <ContextMenu
              x={menu.x}
              y={menu.y}
              onClose={() => setMenu(null)}
              items={list.map((r, i) => ({
                id: String(i),
                label: r.name + ' · ' + r.profile,
                icon: r.world ? 'i-map' : 'i-server',
                onPick: () => {
                  joinWithAuth(r.profile, r.world, r.server, r.server ? r.name : null).catch((e) => showLaunchError(e))
                },
              }))}
            />,
            document.body,
          )
        : null}
    </>
  )
}
