import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'
import type { ContextItem } from './ContextMenu'
import { createBuildShortcut, listServers, listWorlds } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { tx, useT } from '../i18n'

const MAX_TARGETS = 8

/// «Ярлык на рабочий стол»: the build itself, or straight into one of its
/// worlds or servers. Deleting the build deletes its shortcuts too.
export function ShortcutRow({ profile }: { profile: string }) {
  const t = useT()
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const make = (world: string | null, server: string | null) => {
    setBusy(true)
    createBuildShortcut(profile, world, server)
      .then(() => showToast(t('Ярлык на рабочем столе'), 'ok'))
      .catch((e) => showToast(t('Не удалось создать ярлык: {error}', { error: tx(e) }), 'error'))
      .finally(() => setBusy(false))
  }

  const open = async (x: number, y: number) => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'), 'error')
      return
    }
    const [worlds, servers] = await Promise.all([listWorlds(profile).catch(() => []), listServers(profile).catch(() => [])])
    const items: ContextItem[] = [{ id: 'build', label: t('Сборка'), icon: 'i-play', onPick: () => make(null, null) }]
    worlds.slice(0, MAX_TARGETS).forEach((w, i) =>
      items.push({ id: 'w' + w.folder, label: w.name, icon: 'i-map', separated: i === 0, onPick: () => make(w.folder, null) }),
    )
    servers.slice(0, MAX_TARGETS).forEach((s, i) =>
      items.push({ id: 's' + s.ip, label: s.name || s.ip, icon: 'i-server', separated: i === 0, onPick: () => make(null, s.ip) }),
    )
    if (items.length === 1) {
      make(null, null)
      return
    }
    setMenu({ x, y, items })
  }

  return (
    <div className="set-row" id="bsShortcut">
      <span className="lab">{t('Ярлык на рабочий стол')}</span>
      <button
        className="btn sm secondary"
        data-track="build_shortcut"
        disabled={busy}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          void open(r.left, r.bottom + 4)
        }}
      >
        <Icon id="i-plus" /> {t('Создать')}
      </button>
      {menu ? createPortal(<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />, document.body) : null}
    </div>
  )
}
