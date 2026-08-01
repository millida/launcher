import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { openProfileFolder, repairProfile } from '../ipc/commands'
import { showToast } from '../state/ui'
import { useCrash } from '../state/crash'

export function CrashModal() {
  const { info, close } = useCrash()
  const [showTail, setShowTail] = useState(false)
  const [repairing, setRepairing] = useState(false)

  useEffect(() => {
    if (!info) return
    setShowTail(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [info, close])

  if (!info) return null
  return (
    <div
      className="modal-bg open vis"
      style={{ zIndex: 210 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal" style={{ width: '460px' }}>
        <div className="crash-head">
          <span className="crash-ic">
            <Icon id="i-alert" />
          </span>
          <div>
            <h3>Игра вылетела</h3>
            <div className="sub" style={{ marginTop: '2px' }}>
              Сборка «{info.profile}»
            </div>
          </div>
        </div>
        <p className="crash-reason">{info.reason}</p>

        {info.tail ? (
          <>
            <button className="crash-toggle" onClick={() => setShowTail((v) => !v)}>
              <Icon id={showTail ? 'i-chev-d' : 'i-chev-r'} /> {showTail ? 'Скрыть детали' : 'Показать детали лога'}
            </button>
            {showTail ? <pre className="host-console crash-tail">{info.tail}</pre> : null}
          </>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          <button
            className="btn md primary"
            style={{ flex: 1 }}
            disabled={repairing}
            onClick={() => {
              if (!hasTauri()) return
              setRepairing(true)
              showToast('Чиним сборку — проверяем файлы…')
              repairProfile(info.profile)
                .then(() => {
                  showToast('Готово — попробуй запустить снова')
                  close()
                })
                .catch((e) => showToast('Не удалось починить: ' + e, 'error'))
                .finally(() => setRepairing(false))
            }}
          >
            <Icon id="i-restart" /> {repairing ? 'Чиним…' : 'Починить сборку'}
          </button>
          <button className="btn md secondary" onClick={() => hasTauri() && openProfileFolder(info.profile)}>
            Открыть папку
          </button>
          <button className="btn md secondary" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
