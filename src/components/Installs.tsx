import { useEffect } from 'react'
import { Icon } from './Icon'
import { PauseInstall } from './PauseInstall'
import { runningMsg, stopInstall, useInstalls } from '../state/installs'
import { useUi } from '../state/ui'
import { tx, useT } from '../i18n'
import { initDownloadSpeed, speedText, useDownloadSpeed } from '../lib/downloadSpeed'
import { etaText } from '../lib/eta'

export function Installs({ inLobby = false }: { inLobby?: boolean }) {
  const t = useT()
  const tasks = useInstalls((s) => s.tasks)
  const lobbyShown = useUi((s) => s.screen === 'play')
  const list = Object.values(tasks)
  const speed = useDownloadSpeed((s) => speedText(s.bps, s.at))
  useEffect(() => initDownloadSpeed(), [])
  if (!list.length || lobbyShown !== inLobby) return null
  return (
    <div className={inLobby ? 'inst-dock in-lobby' : 'inst-dock'}>
      {list.map((task) => (
        <div key={task.key} className={'inst-card ' + task.state}>
          <Icon id={task.state === 'error' ? 'i-alert' : task.state === 'done' ? 'i-check' : 'i-download'} />
          <div className="inst-body">
            <div className="inst-name">{task.title || t('Установка')}</div>
            <div className="inst-msg">
              {task.state === 'error' ? tx(task.msg) : task.state === 'done' ? t('Готово') : runningMsg(task, tx(task.msg) || t('Готовим…'))}
              {task.state === 'run' && !task.paused && speed ? <span className="inst-speed"> · {speed}</span> : null}
              {task.state === 'run' && !task.paused && task.eta ? <span className="inst-eta"> · {etaText(task.eta)}</span> : null}
            </div>
            {task.state === 'run' ? (
              <div className="inst-bar">
                <i style={{ width: Math.max(3, Math.min(100, task.pct)) + '%' }} />
              </div>
            ) : null}
          </div>
          <PauseInstall task={task} className="inst-stop" />
          {task.state === 'run' ? (
            <button className="inst-stop" aria-label={t('Отменить установку')} onClick={() => stopInstall(task.key)}>
              <Icon id="i-x" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
