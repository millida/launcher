import { Icon } from './Icon'
import { togglePause, type InstallTask } from '../state/installs'
import { useT } from '../i18n'

export function PauseInstall({ task, className, withText = false }: { task: InstallTask | undefined; className: string; withText?: boolean }) {
  const t = useT()
  if (!task || task.state !== 'run' || !task.pausable) return null
  const label = task.paused ? t('Продолжить') : t('Пауза')
  return (
    <button
      className={className}
      aria-label={label}
      title={withText ? undefined : label}
      data-track={task.paused ? 'install_resume' : 'install_pause'}
      onClick={() => togglePause(task.key)}
    >
      <Icon id={task.paused ? 'i-play' : 'i-pause'} />
      {withText ? ' ' + label : null}
    </button>
  )
}
