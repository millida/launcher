import { useState } from 'react'
import { Icon } from './Icon'
import { Cover } from './Cover'
import { ContextMenu, type ContextItem } from './ContextMenu'
import { LOADER_NAME, fmtPlaytime, whenText } from '../lib/format'
import { useProfiles } from '../state/profiles'
import { openBuildSettings, openBuildShare, type InstanceTab } from '../state/instance'
import { realLaunch } from '../lib/launch'
import { useGame } from '../state/game'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { hasTauri } from '../ipc/tauri'
import { deleteProfile, openProfileFolder, type PlayStats } from '../ipc/commands'

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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const go = (tab: InstanceTab, focusRename = false) => {
    setSelected(p.name)
    openBuildSettings(p.name, tab, focusRename)
  }

  const remove = () => {
    void uiConfirm(
      'Удалить сборку «' + p.name + '» со всеми модами, мирами и часами игры? Отменить будет нельзя.',
      { title: 'Удаление сборки', confirmLabel: 'Удалить' },
    ).then((ok) => {
      if (!ok) return
      if (!hasTauri()) {
        showToast('Доступно в приложении', 'error')
        return
      }
      deleteProfile(p.name)
        .then(() => {
          if (useProfiles.getState().selected === p.name) setSelected(null)
          void refresh()
          showToast('Сборка удалена', 'ok', 'delete')
        })
        .catch((e) => {
          void refresh()
          showToast('' + e, 'error')
        })
    })
  }

  const items: ContextItem[] = [
    { id: 'play', label: running ? 'Запустить ещё копию' : 'Играть', icon: 'i-play', onPick: () => realLaunch(p.name) },
    { id: 'rename', label: 'Переименовать', icon: 'i-edit', separated: true, onPick: () => go('opts', true) },
    {
      id: 'share',
      label: 'Поделиться',
      icon: 'i-link',
      onPick: () => {
        setSelected(p.name)
        openBuildShare(p.name)
      },
    },
    { id: 'content', label: 'Контент', icon: 'i-blocks', onPick: () => go('content') },
    { id: 'worlds', label: 'Миры и серверы', icon: 'i-server', onPick: () => go('worlds') },
    { id: 'shots', label: 'Скриншоты', icon: 'i-image', onPick: () => go('shots') },
    { id: 'logs', label: 'Логи', icon: 'i-list', onPick: () => go('logs') },
    { id: 'opts', label: 'Параметры', icon: 'i-settings', onPick: () => go('opts') },
    {
      id: 'folder',
      label: 'Открыть папку сборки',
      icon: 'i-folder',
      separated: true,
      onPick: () => {
        if (!hasTauri()) {
          showToast('Доступно в приложении', 'error')
          return
        }
        openProfileFolder(p.name).catch((e) => showToast('Не удалось открыть папку: ' + e, 'error'))
      },
    },
    { id: 'delete', label: 'Удалить сборку', icon: 'i-trash', danger: true, separated: true, onPick: remove },
  ]

  return (
    <>
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
        onContextMenu={(e) => {
          e.preventDefault()
          setSelected(p.name)
          setMenu({ x: e.clientX, y: e.clientY })
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
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} /> : null}
    </>
  )
}
