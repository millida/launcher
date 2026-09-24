import { useState } from 'react'
import { Icon } from './Icon'
import { Cover } from './Cover'
import { ContextMenu, type ContextItem } from './ContextMenu'
import { LOADER_NAME, fmtPlaytime, whenText } from '../lib/format'
import { useProfiles } from '../state/profiles'
import { openBuildSettings, openBuildShare, type InstanceTab } from '../state/instance'
import { realLaunch } from '../lib/launch'
import { useLobby } from '../state/lobbyMode'
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
      'Сборка «' + p.name + '» удалится с модами, мирами и часами игры. Вернуть нельзя.',
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
          console.error('[build-delete]', e)
          showToast('Не удалось удалить сборку', 'error', false, { label: 'Повторить', run: remove })
        })
    })
  }

  // Запуск сборки — тоже выбор режима: лобби вернёт в неё, как Fortnite
  // возвращает в последний режим.
  const play = () => {
    useLobby.getState().pick({ kind: 'build', name: p.name })
    realLaunch(p.name)
  }

  const items: ContextItem[] = [
    { id: 'play', label: running ? 'Запустить ещё копию' : 'Играть', icon: 'i-play', onPick: () => play() },
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
      label: 'Папка сборки',
      icon: 'i-folder',
      separated: true,
      onPick: () => {
        if (!hasTauri()) {
          showToast('Доступно в приложении', 'error')
          return
        }
        openProfileFolder(p.name).catch((e) => {
          console.error('[build-folder]', e)
          showToast('Не удалось открыть папку', 'error')
        })
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
        data-track="build_card"
        data-kind="build"
        data-id={p.name}
        data-src="hub_card"
        data-private
        onClick={(e) => {
          setSelected(p.name)
          if ((e.target as HTMLElement).closest('.build-cover')) {
            void refresh()
            play()
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
        <span className="build-cover" data-nosound aria-label={running ? 'Запустить ещё одну копию' : 'Играть'}>
          <Cover url={p.icon} />
          {running ? (
            <span className="build-run">
              <span className="run-dot"></span>
              Запущено
            </span>
          ) : null}
          <span className="mini-play" aria-hidden="true">
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
