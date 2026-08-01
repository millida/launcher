import { useUpdate } from '../state/update'

const TITLES: Record<string, string> = {
  checking: 'Проверяем обновления…',
  downloading: 'Скачиваем обновление',
  installing: 'Устанавливаем обновление',
}

export function BootUpdate() {
  const phase = useUpdate((s) => s.bootPhase)
  const pct = useUpdate((s) => s.bootPct)
  const version = useUpdate((s) => s.version)
  if (phase === 'idle' || phase === 'checking') return null

  return (
    <div className="boot-upd">
      <div className="boot-upd-card">
        <img src="/millida-logo.svg" alt="" width={44} height={44} />
        <div className="boot-upd-title">{TITLES[phase]}</div>
        <div className="boot-upd-sub">{version ? 'Версия ' + version : 'Millida Launcher'}</div>
        <div className="boot-upd-bar">
          <span
            className={'boot-upd-fill' + (phase === 'installing' || !pct ? ' pulse' : '')}
            style={pct ? { width: pct + '%' } : undefined}
          />
        </div>
        <div className="boot-upd-note">
          {phase === 'installing' ? 'Лаунчер перезапустится сам' : 'Это займёт несколько секунд'}
        </div>
      </div>
    </div>
  )
}
