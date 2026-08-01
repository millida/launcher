import { Icon } from './Icon'
import { stopInstall, useInstalls } from '../state/installs'

export function Installs() {
  const tasks = useInstalls((s) => s.tasks)
  const list = Object.values(tasks)
  if (!list.length) return null
  return (
    <div className="inst-dock">
      {list.map((t) => (
        <div key={t.key} className={'inst-card ' + t.state}>
          <Icon id={t.state === 'error' ? 'i-alert' : t.state === 'done' ? 'i-check' : 'i-download'} />
          <div className="inst-body">
            <div className="inst-name">{t.title || 'Установка'}</div>
            <div className="inst-msg">
              {t.state === 'error' ? t.msg : t.state === 'done' ? 'Готово' : t.msg || 'Готовим…'}
            </div>
            {t.state === 'run' ? (
              <div className="inst-bar">
                <i style={{ width: Math.max(3, Math.min(100, t.pct)) + '%' }} />
              </div>
            ) : null}
          </div>
          {t.state === 'run' ? (
            <button className="inst-stop" title="Отменить установку" onClick={() => stopInstall(t.key)}>
              <Icon id="i-x" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
