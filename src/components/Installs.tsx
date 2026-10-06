import { Icon } from './Icon'
import { PauseInstall } from './PauseInstall'
import { runningMsg, stopInstall, useInstalls } from '../state/installs'
import { useUi } from '../state/ui'

export function Installs({ inLobby = false }: { inLobby?: boolean }) {
  const tasks = useInstalls((s) => s.tasks)
  const lobbyShown = useUi((s) => s.screen === 'play')
  const list = Object.values(tasks)
  if (!list.length || lobbyShown !== inLobby) return null
  return (
    <div className={inLobby ? 'inst-dock in-lobby' : 'inst-dock'}>
      {list.map((t) => (
        <div key={t.key} className={'inst-card ' + t.state}>
          <Icon id={t.state === 'error' ? 'i-alert' : t.state === 'done' ? 'i-check' : 'i-download'} />
          <div className="inst-body">
            <div className="inst-name">{t.title || 'Установка'}</div>
            <div className="inst-msg">
              {t.state === 'error' ? t.msg : t.state === 'done' ? 'Готово' : runningMsg(t, t.msg || 'Готовим…')}
            </div>
            {t.state === 'run' ? (
              <div className="inst-bar">
                <i style={{ width: Math.max(3, Math.min(100, t.pct)) + '%' }} />
              </div>
            ) : null}
          </div>
          <PauseInstall task={t} className="inst-stop" />
          {t.state === 'run' ? (
            <button className="inst-stop" aria-label="Отменить установку" onClick={() => stopInstall(t.key)}>
              <Icon id="i-x" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
